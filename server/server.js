const express = require("express");
const cors = require("cors");
const { verifyEmail } = require("./verifier");

const app = express();

app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL,
    ],
    methods: ["GET", "POST"],
  })
);

app.use(express.json());

const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Email Verifier API Running 🚀");
});

app.post("/verify", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const result = await verifyEmail(email);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Verification failed",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});