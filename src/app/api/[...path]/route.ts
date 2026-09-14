import { NextRequest } from "next/server";
import { dispatch } from "@/modules/api";
import { handleApi } from "@/modules/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function route(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return handleApi(request, async () =>
    dispatch(request, (await context.params).path),
  );
}
export { route as GET, route as POST, route as PATCH };
