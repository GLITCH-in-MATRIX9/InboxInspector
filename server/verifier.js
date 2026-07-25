#!/usr/bin/env node
'use strict';

/**
 * ============================================================================
 *  verifier.js
 * ----------------------------------------------------------------------------
 *  A professional-grade, dependency-free SMTP email verifier for Node.js.
 *
 *  This tool determines the probability that an email address is deliverable
 *  WITHOUT ever sending an actual message. It does this by:
 *
 *    1. Validating the syntax of the address (RFC 5322-ish, pragmatic subset)
 *    2. Resolving the domain's MX records (RFC 5321 5.1)
 *    3. Opening a raw TCP socket to each MX host, in priority order
 *    4. Speaking SMTP by hand (EHLO / MAIL FROM / RCPT TO / QUIT) to see
 *       whether the destination server is willing to accept the recipient
 *    5. Opportunistically upgrading the connection with STARTTLS (RFC 3207)
 *    6. Probing for "catch-all" domains (domains that accept ANY recipient)
 *       by testing a second, cryptographically random mailbox
 *    7. Classifying the result and producing a 0-100 confidence score
 *
 *  IMPORTANT: At no point does this tool ever issue the SMTP `DATA` command.
 *  The recipient is only ever "offered" to the remote server via `RCPT TO`
 *  and then the transaction is always aborted with `QUIT`. No mail is ever
 *  composed, queued, or delivered. This mirrors exactly what professional
 *  email-verification services (e.g. mailbox pingers) do under the hood.
 *
 *  Usage:
 *      node verifier.js someone@example.com
 *      node verifier.js someone@example.com --verbose
 *
 *  Requires: Node.js 22+, no external dependencies.
 * ============================================================================
 */

const dns = require('dns/promises');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { promisify } = require('util');

/* ============================================================================
 * SECTION 1: CONFIGURATION
 * ----------------------------------------------------------------------------
 * All tunable constants live here so the rest of the file never contains
 * "magic numbers". This is the first thing a maintainer should look at.
 * ============================================================================
 */
const CONFIG = Object.freeze({
  // -- Network timeouts (milliseconds) --
  DNS_TIMEOUT_MS: 8_000,
  CONNECT_TIMEOUT_MS: 10_000,
  COMMAND_TIMEOUT_MS: 12_000,
  STARTTLS_TIMEOUT_MS: 10_000,
  OVERALL_TIMEOUT_MS: 30_000,

  // -- SMTP --
  SMTP_PORT: 25,
  EHLO_HOSTNAME: 'verifier.local',
  MAIL_FROM_ADDRESS: 'probe@verifier.local',

  // -- Retry behavior --
  MAX_MX_SERVERS_TO_TRY: 4,
  MAX_CONNECTION_RETRIES_PER_HOST: 2,
  RETRY_BACKOFF_BASE_MS: 500,

  // -- Rate limiting (politeness delay between SMTP commands, ms) --
  MIN_COMMAND_DELAY_MS: 150,
  MAX_COMMAND_DELAY_MS: 400,

  // -- Catch-all detection --
  RANDOM_MAILBOX_LOCAL_PART_BYTES: 7, // -> 14 hex chars

  // -- Confidence scoring weights --
  SCORE_SYNTAX_VALID: 5,
  SCORE_MX_FOUND: 20,
  SCORE_SMTP_CONNECTED: 20,
  SCORE_RECIPIENT_ACCEPTED: 30,
  SCORE_NOT_CATCH_ALL: 20,
  SCORE_STARTTLS_SUCCESS: 5,

  SCORE_PENALTY_TEMP_FAILURE: 25,
  SCORE_PENALTY_TIMEOUT: 20,
  SCORE_PENALTY_GREYLISTED: 15,
  SCORE_PENALTY_CATCH_ALL: 35,

  // -- CLI --
  BOX_WIDTH: 50,
});

/* ============================================================================
 * SECTION 2: LOGGER
 * ----------------------------------------------------------------------------
 * Tiny logging + ANSI color helper. No packages, just raw escape codes.
 * Supports a "verbose" mode that echoes the raw SMTP conversation.
 * ============================================================================
 */
const ANSI = Object.freeze({
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
});

class Logger {
  constructor(verbose = false) {
    this.verbose = verbose;
  }

  paint(color, text) {
    return `${ANSI[color] || ''}${text}${ANSI.reset}`;
  }

  green(text) { return this.paint('green', text); }
  red(text) { return this.paint('red', text); }
  yellow(text) { return this.paint('yellow', text); }
  cyan(text) { return this.paint('cyan', text); }
  gray(text) { return this.paint('gray', text); }
  bold(text) { return this.paint('bold', text); }

  // Echoes a raw SMTP command sent to the server (verbose mode only).
  smtpOut(line) {
    if (this.verbose) {
      process.stdout.write(`${this.gray('C:')} ${this.cyan(line.trimEnd())}\n`);
    }
  }

  // Echoes a raw SMTP response received from the server (verbose mode only).
  smtpIn(line) {
    if (this.verbose) {
      process.stdout.write(`${this.gray('S:')} ${this.yellow(line.trimEnd())}\n`);
    }
  }

  info(msg) {
    if (this.verbose) process.stdout.write(`${this.gray('[info]')} ${msg}\n`);
  }

  warn(msg) {
    if (this.verbose) process.stdout.write(`${this.yellow('[warn]')} ${msg}\n`);
  }

  error(msg) {
    process.stderr.write(`${this.red('[error]')} ${msg}\n`);
  }
}

/* ============================================================================
 * SECTION 3: UTILITIES
 * ============================================================================
 */

/** Sleep helper used for rate-limiting and retry backoff. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a promise with a hard timeout. If the promise doesn't settle within
 * `ms` milliseconds, the returned promise rejects with a TimeoutError.
 */
function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Timed out after ${ms}ms while waiting for: ${label}`);
      err.name = 'TimeoutError';
      err.isTimeout = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Returns a random integer delay used to politely pace SMTP commands. */
function randomCommandDelay() {
  const { MIN_COMMAND_DELAY_MS, MAX_COMMAND_DELAY_MS } = CONFIG;
  return MIN_COMMAND_DELAY_MS + Math.floor(Math.random() * (MAX_COMMAND_DELAY_MS - MIN_COMMAND_DELAY_MS));
}

/**
 * Generates a cryptographically random, guaranteed-nonexistent mailbox local
 * part. Used for catch-all detection: if a domain accepts mail to a mailbox
 * that could not possibly have been provisioned by anyone, the domain is
 * almost certainly configured to accept *any* recipient ("catch-all"),
 * which makes RCPT TO acceptance meaningless as a signal of deliverability.
 */
function generateRandomLocalPart() {
  return crypto.randomBytes(CONFIG.RANDOM_MAILBOX_LOCAL_PART_BYTES).toString('hex');
}

/** Formats a millisecond duration for human-readable reporting. */
function formatDuration(ms) {
  return `${Math.round(ms)} ms`;
}

/* ============================================================================
 * SECTION 4: SYNTAX VALIDATOR
 * ----------------------------------------------------------------------------
 * A pragmatic (not 100% RFC 5322 complete, since that grammar is enormous
 * and mostly irrelevant to real-world mail) syntax validator. It rejects
 * the overwhelming majority of malformed addresses while accepting the
 * overwhelming majority of real ones.
 * ============================================================================
 */
const EMAIL_SYNTAX_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function validateSyntax(email) {
  if (typeof email !== 'string' || email.length === 0 || email.length > 254) {
    return { valid: false, reason: 'Address is empty or exceeds 254 characters' };
  }
  const atCount = (email.match(/@/g) || []).length;
  if (atCount !== 1) {
    return { valid: false, reason: 'Address must contain exactly one "@" symbol' };
  }
  const [localPart, domainPart] = email.split('@');
  if (!localPart || localPart.length > 64) {
    return { valid: false, reason: 'Local part is missing or exceeds 64 characters' };
  }
  if (!domainPart || domainPart.length > 253) {
    return { valid: false, reason: 'Domain part is missing or exceeds 253 characters' };
  }
  if (!EMAIL_SYNTAX_REGEX.test(email)) {
    return { valid: false, reason: 'Address does not conform to expected syntax' };
  }
  return { valid: true, reason: null };
}

/** Extracts the domain portion of an already-validated email address. */
function extractDomain(email) {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/* ============================================================================
 * SECTION 5: DNS / MX RESOLVER
 * ----------------------------------------------------------------------------
 * Resolves MX records for a domain (RFC 5321 section 5) and sorts them by
 * priority (lower preference value = higher priority, tried first). Falls
 * back to using the bare domain as an implicit MX (RFC 5321 5.1) if no MX
 * records exist but an A/AAAA record does, since some domains rely on this
 * legacy fallback.
 * ============================================================================
 */
async function resolveMxServers(domain, logger) {
  logger.info(`Resolving MX records for ${domain}...`);
  let records;
  try {
    records = await withTimeout(dns.resolveMx(domain), CONFIG.DNS_TIMEOUT_MS, 'DNS MX lookup');
  } catch (err) {
    if (err.code === 'ENODATA' || err.code === 'ENOTFOUND' || err.code === 'ESERVFAIL') {
      records = [];
    } else if (err.isTimeout) {
      throw err;
    } else {
      throw err;
    }
  }

  if (!records || records.length === 0) {
    // RFC 5321 fallback: if no MX records exist, an A/AAAA record on the
    // domain itself may be used as an implicit single MX with preference 0.
    logger.info('No MX records found, attempting implicit MX fallback (A/AAAA)...');
    try {
      const addresses = await withTimeout(dns.resolve4(domain), CONFIG.DNS_TIMEOUT_MS, 'DNS A lookup');
      if (addresses && addresses.length > 0) {
        return [{ exchange: domain, priority: 0 }];
      }
    } catch (_) {
      // fall through -> no MX
    }
    return [];
  }

  // Sort ascending by priority: RFC 5321 mandates lower preference numbers
  // are tried first.
  records.sort((a, b) => a.priority - b.priority);
  logger.info(`Found ${records.length} MX record(s): ${records.map((r) => `${r.exchange}(${r.priority})`).join(', ')}`);
  return records.slice(0, CONFIG.MAX_MX_SERVERS_TO_TRY);
}

/* ============================================================================
 * SECTION 6: SMTP RESPONSE PARSER
 * ----------------------------------------------------------------------------
 * SMTP replies (RFC 5321 section 4.2) consist of a 3-digit status code
 * followed by either a space (final line) or a hyphen (continuation line,
 * meaning more lines follow before the reply is complete), e.g.:
 *
 *   250-mail.example.com Hello
 *   250-SIZE 35882577
 *   250-STARTTLS
 *   250 HELP
 *
 * This parser buffers raw socket bytes, splits them into CRLF-terminated
 * lines, and assembles complete multi-line replies before handing them to
 * the SMTP client state machine.
 * ============================================================================
 */
class SmtpResponseParser {
  constructor() {
    this.buffer = '';
  }

  /**
   * Feeds newly-received bytes into the parser. Returns an array of zero or
   * more *complete* SMTP replies found in the accumulated buffer. A reply is
   * only "complete" once a line arrives whose 3-digit code is followed by a
   * space (not a hyphen), per RFC 5321 4.2.1.
   */
  push(chunk) {
    this.buffer += chunk;
    const completedReplies = [];

    // Keep peeling complete lines off the buffer.
    let newlineIndex;
    let pendingLines = [];

    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const rawLine = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (rawLine.length === 0) continue;
      pendingLines.push(rawLine);

      const match = /^(\d{3})([ -])/.exec(rawLine);
      if (!match) {
        // Malformed line; skip it defensively rather than crashing.
        continue;
      }
      const [, code, separator] = match;

      if (separator === ' ') {
        // Final line of a (possibly multi-line) reply.
        completedReplies.push({
          code: parseInt(code, 10),
          lines: pendingLines,
          raw: pendingLines.join('\n'),
        });
        pendingLines = [];
      }
      // If separator is '-', keep accumulating; more lines are coming.
    }

    return completedReplies;
  }
}

/* ============================================================================
 * SECTION 7: SMTP STATUS CODE REFERENCE
 * ----------------------------------------------------------------------------
 * A lookup table describing the meaning and category of every SMTP status
 * code this verifier explicitly understands, per RFC 5321 and common
 * real-world extensions (e.g. 521 "domain does not accept mail").
 * ============================================================================
 */
const SMTP_STATUS_CODES = Object.freeze({
  220: { meaning: 'Service ready', category: 'success' },
  250: { meaning: 'Requested action completed OK', category: 'success' },
  354: { meaning: 'Start mail input (not used — DATA is never sent)', category: 'success' },
  421: { meaning: 'Service not available, closing transmission channel', category: 'temporary' },
  450: { meaning: 'Mailbox unavailable (busy/blocked) — greylisting candidate', category: 'temporary' },
  451: { meaning: 'Local error in processing / greylisting', category: 'temporary' },
  452: { meaning: 'Insufficient system storage', category: 'temporary' },
  500: { meaning: 'Syntax error, command unrecognized', category: 'permanent' },
  501: { meaning: 'Syntax error in parameters or arguments', category: 'permanent' },
  502: { meaning: 'Command not implemented', category: 'permanent' },
  503: { meaning: 'Bad sequence of commands', category: 'permanent' },
  504: { meaning: 'Command parameter not implemented', category: 'permanent' },
  521: { meaning: 'Domain does not accept mail', category: 'permanent' },
  530: { meaning: 'Authentication required', category: 'permanent' },
  535: { meaning: 'Authentication failed', category: 'permanent' },
  550: { meaning: 'Mailbox unavailable / does not exist', category: 'permanent' },
  551: { meaning: 'User not local, please try alternate path', category: 'permanent' },
  552: { meaning: 'Exceeded storage allocation', category: 'permanent' },
  553: { meaning: 'Mailbox name not allowed', category: 'permanent' },
  554: { meaning: 'Transaction failed', category: 'permanent' },
});

/** Common phrases mail servers use in temporary-failure text to signal greylisting. */
const GREYLISTING_PATTERNS = [
  /greylist/i,
  /grey.?listed/i,
  /gray.?listed/i,
  /try again later/i,
  /temporarily deferred/i,
  /please try again/i,
  /rate limit/i,
  /come back later/i,
  /4\.7\.1/,
];

function isGreylistingResponse(reply) {
  if (!reply) return false;
  if (reply.code !== 450 && reply.code !== 451) return false;
  return GREYLISTING_PATTERNS.some((pattern) => pattern.test(reply.raw));
}

function classifySmtpCode(code) {
  const entry = SMTP_STATUS_CODES[code];
  if (entry) return entry.category;
  if (code >= 200 && code < 300) return 'success';
  if (code >= 400 && code < 500) return 'temporary';
  if (code >= 500 && code < 600) return 'permanent';
  return 'unknown';
}

/* ============================================================================
 * SECTION 8: SMTP CLIENT
 * ----------------------------------------------------------------------------
 * Hand-rolled SMTP client built directly on top of `net.Socket` (and, after
 * an optional STARTTLS upgrade, `tls.TLSSocket`). No smtp-client / nodemailer
 * dependency of any kind — every command is written to the wire manually.
 *
 * The class is a small EventEmitter so verbose logging and future consumers
 * can observe the raw conversation if desired, though this file drives it
 * directly via async methods for simplicity.
 * ============================================================================
 */
class SmtpClient extends EventEmitter {
  constructor(host, port, logger) {
    super();
    this.host = host;
    this.port = port;
    this.logger = logger;
    this.socket = null;
    this.parser = new SmtpResponseParser();
    this.replyQueue = [];
    this.waiters = [];
    this.secure = false;
  }

  /* ---- low-level plumbing ------------------------------------------- */

  _attachSocketHandlers(socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      const replies = this.parser.push(chunk);
      for (const reply of replies) {
        for (const line of reply.lines) this.logger.smtpIn(line);
        if (this.waiters.length > 0) {
          const resolve = this.waiters.shift();
          resolve(reply);
        } else {
          this.replyQueue.push(reply);
        }
      }
    });
    socket.on('error', (err) => {
      this.emit('socketError', err);
    });
  }

  /** Opens the initial plaintext TCP connection to the MX host. */
  async connect() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const onConnect = () => {
        cleanup();
        this.socket = socket;
        this._attachSocketHandlers(socket);
        resolve();
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        socket.removeListener('connect', onConnect);
        socket.removeListener('error', onError);
      };
      socket.once('connect', onConnect);
      socket.once('error', onError);
      socket.setTimeout(CONFIG.CONNECT_TIMEOUT_MS, () => {
        socket.destroy(new Error(`Connection to ${this.host}:${this.port} timed out`));
      });
    });
  }

  /** Waits for the next complete SMTP reply, honoring a command timeout. */
  waitForReply(label) {
    const pending = new Promise((resolve) => {
      if (this.replyQueue.length > 0) {
        resolve(this.replyQueue.shift());
      } else {
        this.waiters.push(resolve);
      }
    });
    return withTimeout(pending, CONFIG.COMMAND_TIMEOUT_MS, label);
  }

  /** Sends a raw SMTP command line (CRLF-terminated, per RFC 5321). */
  async sendCommand(command, label) {
    this.logger.smtpOut(command);
    await sleep(randomCommandDelay()); // politeness / rate limiting
    this.socket.write(`${command}\r\n`);
    return this.waitForReply(label || command);
  }

  /** Reads the server's unsolicited greeting banner (the initial 220). */
  async readGreeting() {
    return this.waitForReply('220 greeting');
  }

  /* ---- SMTP verbs ----------------------------------------------------
   * Each verb below is implemented exactly per RFC 5321. We deliberately
   * never implement DATA — this verifier only ever probes acceptance via
   * RCPT TO and then tears the transaction down with QUIT/RSET.
   * -------------------------------------------------------------------- */

  async ehlo() {
    return this.sendCommand(`EHLO ${CONFIG.EHLO_HOSTNAME}`, 'EHLO');
  }

  async helo() {
    return this.sendCommand(`HELO ${CONFIG.EHLO_HOSTNAME}`, 'HELO');
  }

  async mailFrom(address) {
    return this.sendCommand(`MAIL FROM:<${address}>`, 'MAIL FROM');
  }

  async rcptTo(address) {
    return this.sendCommand(`RCPT TO:<${address}>`, 'RCPT TO');
  }

  async rset() {
    return this.sendCommand('RSET', 'RSET');
  }

  async quit() {
    try {
      await this.sendCommand('QUIT', 'QUIT');
    } catch (_) {
      // Best-effort; we're closing the socket regardless.
    }
  }

  /**
   * Upgrades the plaintext socket to TLS in-place using STARTTLS (RFC 3207).
   * After a successful upgrade, the SMTP session must be restarted with a
   * fresh EHLO, since prior EHLO capabilities are no longer trustworthy.
   */
  async upgradeToTls() {
    return new Promise((resolve, reject) => {
      const plainSocket = this.socket;
      // Stop the plaintext socket from emitting further 'data' events —
      // TLS negotiation needs exclusive control of the underlying stream.
      plainSocket.removeAllListeners('data');

      const tlsSocket = tls.connect({
        socket: plainSocket,
        servername: this.host,
        rejectUnauthorized: false, // mail servers frequently use self-signed / mismatched certs
        timeout: CONFIG.STARTTLS_TIMEOUT_MS,
      });

      const timer = setTimeout(() => {
        tlsSocket.destroy();
        reject(new Error('STARTTLS handshake timed out'));
      }, CONFIG.STARTTLS_TIMEOUT_MS);

      tlsSocket.once('secureConnect', () => {
        clearTimeout(timer);
        this.parser = new SmtpResponseParser(); // fresh parser state post-upgrade
        this.socket = tlsSocket;
        this.secure = true;
        this._attachSocketHandlers(tlsSocket);
        resolve(tlsSocket.getCertificate ? tlsSocket : tlsSocket);
      });

      tlsSocket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** Closes the socket immediately, ignoring any errors. */
  destroy() {
    try {
      if (this.socket && !this.socket.destroyed) this.socket.destroy();
    } catch (_) {
      /* noop */
    }
  }
}

/* ============================================================================
 * SECTION 9: VERIFICATION ENGINE
 * ----------------------------------------------------------------------------
 * Orchestrates the full pipeline: syntax -> MX -> SMTP conversation ->
 * STARTTLS -> catch-all probe -> classification -> scoring.
 * Implements retry-across-MX-servers and per-host connection retries.
 * ============================================================================
 */

/**
 * Attempts a full SMTP probe against a single MX host: connect, EHLO,
 * optional STARTTLS, MAIL FROM, RCPT TO for the target address, and
 * (if the primary probe looked like acceptance) a second RCPT TO for a
 * random catch-all-detection mailbox. Always ends with QUIT.
 */
async function probeMxHost(mxHost, targetEmail, logger) {
  const result = {
    host: mxHost,
    connected: false,
    starttls: false,
    starttlsAttempted: false,
    ehloResponse: null,
    mailFromResponse: null,
    rcptToResponse: null,
    catchAllRcptResponse: null,
    greylisted: false,
    error: null,
  };

  const client = new SmtpClient(mxHost, CONFIG.SMTP_PORT, logger);

  try {
    logger.info(`Connecting to ${mxHost}:${CONFIG.SMTP_PORT}...`);
    await withTimeout(client.connect(), CONFIG.CONNECT_TIMEOUT_MS, `TCP connect to ${mxHost}`);
    result.connected = true;

    const greeting = await client.readGreeting();
    if (classifySmtpCode(greeting.code) !== 'success') {
      throw Object.assign(new Error(`Server greeting was not successful: ${greeting.raw}`), { reply: greeting });
    }

    // --- EHLO -----------------------------------------------------------
    let ehloReply = await client.ehlo();
    if (classifySmtpCode(ehloReply.code) !== 'success') {
      // Some legacy servers only support HELO.
      logger.warn('EHLO rejected, falling back to HELO');
      ehloReply = await client.helo();
    }
    result.ehloResponse = ehloReply;

    const supportsStartTls = ehloReply.lines.some((line) => /STARTTLS/i.test(line));

    // --- STARTTLS (opportunistic) ---------------------------------------
    if (supportsStartTls) {
      result.starttlsAttempted = true;
      try {
        const startTlsReply = await client.sendCommand('STARTTLS', 'STARTTLS');
        if (classifySmtpCode(startTlsReply.code) === 'success') {
          await withTimeout(client.upgradeToTls(), CONFIG.STARTTLS_TIMEOUT_MS, 'TLS handshake');
          result.starttls = true;
          logger.info('STARTTLS upgrade succeeded; re-issuing EHLO over TLS');
          // Per RFC 3207, we must discard prior capabilities and re-EHLO.
          const secondEhlo = await client.ehlo();
          result.ehloResponse = secondEhlo;
        } else {
          logger.warn(`STARTTLS offer rejected: ${startTlsReply.raw}`);
        }
      } catch (tlsErr) {
        // Fall back gracefully: continue the session in plaintext.
        logger.warn(`STARTTLS failed, continuing in plaintext: ${tlsErr.message}`);
        result.starttls = false;
      }
    }

    // --- MAIL FROM --------------------------------------------------------
    const mailFromReply = await client.mailFrom(CONFIG.MAIL_FROM_ADDRESS);
    result.mailFromResponse = mailFromReply;
    if (classifySmtpCode(mailFromReply.code) !== 'success') {
      throw Object.assign(new Error(`MAIL FROM rejected: ${mailFromReply.raw}`), { reply: mailFromReply });
    }

    // --- RCPT TO (the actual address under test) --------------------------
    const rcptReply = await client.rcptTo(targetEmail);
    result.rcptToResponse = rcptReply;
    result.greylisted = result.greylisted || isGreylistingResponse(rcptReply);

    const targetAccepted = classifySmtpCode(rcptReply.code) === 'success';

    // --- Catch-all probe ----------------------------------------------
    // Only worth checking if the real mailbox looked accepted; if it was
    // rejected outright there is no ambiguity to resolve.
    if (targetAccepted) {
      const domain = extractDomain(targetEmail);
      const randomAddress = `${generateRandomLocalPart()}@${domain}`;

      // Reset the transaction envelope before starting a new one.
      await client.rset();
      await client.mailFrom(CONFIG.MAIL_FROM_ADDRESS);
      const catchAllReply = await client.rcptTo(randomAddress);
      result.catchAllRcptResponse = catchAllReply;
      result.greylisted = result.greylisted || isGreylistingResponse(catchAllReply);
    }

    await client.quit();
  } catch (err) {
    result.error = err;
  } finally {
    client.destroy();
  }

  return result;
}

/**
 * Tries every MX host in priority order, retrying transient connection
 * failures on the same host before moving to the next MX server. Returns
 * the first probe result that establishes a usable SMTP session, or the
 * last failure encountered if all hosts/retries are exhausted.
 */
async function probeWithRetries(mxServers, targetEmail, logger) {
  let lastResult = null;

  for (const mx of mxServers) {
    for (let attempt = 0; attempt <= CONFIG.MAX_CONNECTION_RETRIES_PER_HOST; attempt++) {
      logger.info(`Attempt ${attempt + 1} against MX host ${mx.exchange} (priority ${mx.priority})`);
      try {
        const result = await probeMxHost(mx.exchange, targetEmail, logger);
        lastResult = result;

        // Success = we actually connected and got a definitive (non-crash)
        // response. If the failure was a connection-level problem, retry;
        // if it was an SMTP-level rejection, that's a legitimate answer —
        // no need to retry other hosts.
        if (result.connected) {
          return result;
        }
      } catch (err) {
        lastResult = { host: mx.exchange, connected: false, error: err };
      }

      if (attempt < CONFIG.MAX_CONNECTION_RETRIES_PER_HOST) {
        const backoff = CONFIG.RETRY_BACKOFF_BASE_MS * (attempt + 1);
        logger.warn(`Retrying ${mx.exchange} in ${backoff}ms...`);
        await sleep(backoff);
      }
    }
  }

  return lastResult;
}

/* ============================================================================
 * SECTION 10: CLASSIFICATION + SCORING ENGINE
 * ----------------------------------------------------------------------------
 * Turns the raw probe result into one of the documented result categories,
 * plus a 0-100 confidence score.
 * ============================================================================
 */
const RESULT_CATEGORY = Object.freeze({
  VALID: 'VALID',
  INVALID: 'INVALID',
  UNKNOWN: 'UNKNOWN',
  CATCH_ALL: 'CATCH_ALL',
  TEMPORARY_FAILURE: 'TEMPORARY_FAILURE',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  NO_MX: 'NO_MX',
  INVALID_SYNTAX: 'INVALID_SYNTAX',
});

function classifyAndScore({ syntaxValid, mxFound, probeResult }) {
  let score = 0;
  const flags = {
    syntaxValid,
    mxFound,
    smtpConnected: false,
    starttls: false,
    recipientAccepted: false,
    catchAll: false,
    greylisted: false,
    temporaryFailure: false,
    timedOut: false,
  };

  if (!syntaxValid) {
    return { category: RESULT_CATEGORY.INVALID_SYNTAX, score: 0, flags };
  }
  score += CONFIG.SCORE_SYNTAX_VALID;

  if (!mxFound) {
    return { category: RESULT_CATEGORY.NO_MX, score, flags };
  }
  score += CONFIG.SCORE_MX_FOUND;

  if (!probeResult || !probeResult.connected) {
    flags.timedOut = Boolean(probeResult && probeResult.error && probeResult.error.isTimeout);
    if (flags.timedOut) score = Math.max(0, score - CONFIG.SCORE_PENALTY_TIMEOUT);
    return { category: RESULT_CATEGORY.CONNECTION_FAILED, score, flags };
  }

  flags.smtpConnected = true;
  score += CONFIG.SCORE_SMTP_CONNECTED;

  if (probeResult.starttls) {
    flags.starttls = true;
    score += CONFIG.SCORE_STARTTLS_SUCCESS;
  }

  flags.greylisted = Boolean(probeResult.greylisted);
  if (flags.greylisted) {
    score = Math.max(0, score - CONFIG.SCORE_PENALTY_GREYLISTED);
  }

  const rcpt = probeResult.rcptToResponse;
  if (!rcpt) {
    // We never even got a RCPT reply (e.g. MAIL FROM was rejected upstream).
    const mailFromCategory = probeResult.mailFromResponse
      ? classifySmtpCode(probeResult.mailFromResponse.code)
      : 'unknown';
    if (mailFromCategory === 'temporary') {
      flags.temporaryFailure = true;
      score = Math.max(0, score - CONFIG.SCORE_PENALTY_TEMP_FAILURE);
      return { category: RESULT_CATEGORY.TEMPORARY_FAILURE, score, flags };
    }
    return { category: RESULT_CATEGORY.UNKNOWN, score, flags };
  }

  const rcptCategory = classifySmtpCode(rcpt.code);

  if (rcptCategory === 'success') {
    flags.recipientAccepted = true;
    score += CONFIG.SCORE_RECIPIENT_ACCEPTED;

    // Determine catch-all status from the parallel random-mailbox probe.
    const catchAllReply = probeResult.catchAllRcptResponse;
    const catchAllAccepted = catchAllReply && classifySmtpCode(catchAllReply.code) === 'success';

    if (catchAllAccepted) {
      flags.catchAll = true;
      score = Math.max(0, score - CONFIG.SCORE_PENALTY_CATCH_ALL);
      return { category: RESULT_CATEGORY.CATCH_ALL, score, flags };
    }

    score += CONFIG.SCORE_NOT_CATCH_ALL;
    return { category: RESULT_CATEGORY.VALID, score: Math.min(100, score), flags };
  }

  if (rcptCategory === 'temporary') {
    flags.temporaryFailure = true;
    score = Math.max(0, score - CONFIG.SCORE_PENALTY_TEMP_FAILURE);
    return { category: RESULT_CATEGORY.TEMPORARY_FAILURE, score, flags };
  }

  // Permanent rejection (5xx) of the specific mailbox = confidently invalid.
  return { category: RESULT_CATEGORY.INVALID, score: 0, flags };
}

/* ============================================================================
 * SECTION 11: REPORT GENERATOR (CLI OUTPUT)
 * ============================================================================
 */
function checkGlyph(ok, logger) {
  return ok ? logger.green('\u2714') : logger.red('\u2716');
}

function categoryColor(category, logger) {
  switch (category) {
    case RESULT_CATEGORY.VALID:
      return logger.green(category);
    case RESULT_CATEGORY.CATCH_ALL:
    case RESULT_CATEGORY.TEMPORARY_FAILURE:
    case RESULT_CATEGORY.UNKNOWN:
      return logger.yellow(category);
    default:
      return logger.red(category);
  }
}

function printReport({ email, domain, syntax, mx, probeResult, classification, mxHostUsed, elapsedMs, logger }) {
  const line = '='.repeat(CONFIG.BOX_WIDTH);
  const out = [];

  out.push(logger.bold(line));
  out.push(logger.bold('EMAIL VERIFICATION REPORT'));
  out.push(line);
  out.push('');
  out.push('Email:');
  out.push(email);
  out.push('');
  out.push('Domain:');
  out.push(domain || '(unresolved)');
  out.push('');
  out.push('Syntax:');
  out.push(`${checkGlyph(syntax.valid, logger)} ${syntax.valid ? 'Valid' : `Invalid (${syntax.reason})`}`);
  out.push('');
  out.push('MX:');
  out.push(`${checkGlyph(mx.found, logger)} ${mx.found ? 'Found' : 'Not Found'}`);
  out.push('');
  out.push('SMTP:');
  const smtpConnected = Boolean(probeResult && probeResult.connected);
  out.push(`${checkGlyph(smtpConnected, logger)} ${smtpConnected ? 'Connected' : 'Not Connected'}`);
  out.push('');
  out.push('STARTTLS:');
  if (probeResult && probeResult.starttlsAttempted) {
    out.push(`${checkGlyph(probeResult.starttls, logger)} ${probeResult.starttls ? 'Supported' : 'Failed / Unavailable'}`);
  } else {
    out.push(`${logger.gray('\u2013')} Not Offered`);
  }
  out.push('');
  out.push('Recipient:');
  out.push(`${checkGlyph(classification.flags.recipientAccepted, logger)} ${classification.flags.recipientAccepted ? 'Accepted' : 'Not Accepted'}`);
  out.push('');
  out.push('Catch-all:');
  out.push(classification.flags.catchAll ? logger.yellow('Yes') : 'No');
  out.push('');
  out.push('Greylisting:');
  out.push(classification.flags.greylisted ? logger.yellow('Yes') : 'No');
  out.push('');
  out.push('Result:');
  out.push(categoryColor(classification.category, logger));
  out.push('');
  out.push('Confidence:');
  out.push(`${classification.score}%`);
  out.push('');
  out.push('MX Server:');
  out.push(mxHostUsed || '(none)');
  out.push('');
  out.push('Elapsed Time:');
  out.push(formatDuration(elapsedMs));
  out.push('');
  out.push(logger.bold(line));

  process.stdout.write(out.join('\n') + '\n');
}

/* ============================================================================
 * SECTION 12: MAIN VERIFICATION PIPELINE
 * ============================================================================
 */
async function verifyEmail(email, options = {}) {
  const logger = new Logger(Boolean(options.verbose));
  const startedAt = Date.now();

  // --- STEP 1: Syntax ------------------------------------------------------
  const syntax = validateSyntax(email);
  if (!syntax.valid) {
    const classification = classifyAndScore({ syntaxValid: false, mxFound: false, probeResult: null });
    return finalizeReport({ email, domain: null, syntax, mx: { found: false }, probeResult: null, classification, mxHostUsed: null, startedAt, logger });
  }

  // --- STEP 2: Domain extraction -------------------------------------------
  const domain = extractDomain(email);

  // --- STEP 3: MX resolution ------------------------------------------------
  let mxServers = [];
  try {
    mxServers = await resolveMxServers(domain, logger);
  } catch (err) {
    logger.warn(`MX resolution failed: ${err.message}`);
    mxServers = [];
  }
  const mx = { found: mxServers.length > 0 };

  if (!mx.found) {
    const classification = classifyAndScore({ syntaxValid: true, mxFound: false, probeResult: null });
    return finalizeReport({ email, domain, syntax, mx, probeResult: null, classification, mxHostUsed: null, startedAt, logger });
  }

  // --- STEP 4-7: SMTP conversation, STARTTLS, catch-all probe --------------
  const probeResult = await withTimeout(
    probeWithRetries(mxServers, email, logger),
    CONFIG.OVERALL_TIMEOUT_MS,
    'overall SMTP verification'
  ).catch((err) => ({ connected: false, error: err }));

  // --- STEP 8-9: Classification + scoring -----------------------------------
  const classification = classifyAndScore({ syntaxValid: true, mxFound: true, probeResult });

  return finalizeReport({
    email,
    domain,
    syntax,
    mx,
    probeResult,
    classification,
    mxHostUsed: probeResult ? probeResult.host : null,
    startedAt,
    logger,
  });
}

function finalizeReport({ email, domain, syntax, mx, probeResult, classification, mxHostUsed, startedAt, logger }) {
  const elapsedMs = Date.now() - startedAt;
  const report = {
    email,
    domain,
    syntax,
    mx,
    probeResult,
    classification,
    mxHostUsed,
    elapsedMs,
  };
  printReport({ email, domain, syntax, mx, probeResult, classification, mxHostUsed, elapsedMs, logger });
  return report;
}

/* ============================================================================
 * SECTION 13: CLI ENTRY POINT
 * ============================================================================
 */
function parseCliArgs(argv) {
  const args = argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const email = args.find((a) => !a.startsWith('-'));
  return { email, verbose };
}

async function main() {
  const { email, verbose } = parseCliArgs(process.argv);

  if (!email) {
    process.stderr.write('Usage: node verifier.js <email> [--verbose]\n');
    process.exitCode = 1;
    return;
  }

  try {
    const report = await verifyEmail(email, { verbose });
    // Exit code reflects the verification outcome for easy scripting.
    process.exitCode = report.classification.category === RESULT_CATEGORY.VALID ? 0 : 2;
  } catch (err) {
    process.stderr.write(`Unexpected error: ${err.stack || err.message}\n`);
    process.exitCode = 1;
  }
}

// Only auto-run when invoked directly (not when required as a module).
if (require.main === module) {
  main();
}

module.exports = {
  verifyEmail,
  validateSyntax,
  extractDomain,
  resolveMxServers,
  classifySmtpCode,
  isGreylistingResponse,
  classifyAndScore,
  RESULT_CATEGORY,
  CONFIG,
  SmtpClient,
  SmtpResponseParser,
};