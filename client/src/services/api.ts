import axios from "axios";
import type { VerifyApiResponse } from "../types/email";

const API_URL =
  import.meta.env.DEV
    ? "http://localhost:5000"
    : import.meta.env.VITE_API_URL;

const api = axios.create({
  baseURL: API_URL,
});

export async function verifyEmail(email: string) {
  const response = await api.post<VerifyApiResponse>("/verify", {
    email,
  });

  return response.data;
}