import axios from "axios";
import type { VerifyApiResponse } from "../types/email";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

export async function verifyEmail(email: string) {
  const response = await api.post<VerifyApiResponse>("/verify", {
    email,
  });

  return response.data;
}