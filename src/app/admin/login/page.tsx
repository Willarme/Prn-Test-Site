import { redirect } from "next/navigation";

// Sign-in is rendered by the admin gate on whichever page you land on.
export default function AdminLoginRedirect() {
  redirect("/admin");
}
