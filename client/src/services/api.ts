import axios from "axios";
import type { VerifyApiResponse } from "../types/email";

const api = axios.create({
  baseURL: "http://localhost:5000",
});

export async function verifyEmail(email: string) {
  const response = await api.post<VerifyApiResponse>("/verify", {
    email,
  });

  return response.data;
}