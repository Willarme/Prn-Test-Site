import { NextResponse } from "next/server";
import { z } from "zod";
import { adminBoundary, guardAdminMutation } from "@/platform/admin/request";
import { readAdminJson } from "@/platform/admin/body";
import { checkConnections } from "@/platform/admin/connections";

export async function POST(request: Request) {
  return adminBoundary(async () => {
    const denied = await guardAdminMutation(request);
    if (denied) return denied;
    const body = await readAdminJson(request, z.object({}).strict(), 128);
    if (!body.ok) return body.response;
    return NextResponse.json(await checkConnections());
  });
}
