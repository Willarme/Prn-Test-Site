import { afterEach, expect, it, vi } from "vitest";
const sign = vi.hoisted(() => vi.fn());
vi.mock("@/platform/db/client", () => ({
  fileStoreForced: () => false, serviceConfigured: () => true,
  requireServiceClient: () => ({ storage: { from: () => ({ createSignedUrl: sign }) } }),
}));
import { readPrivateMediaBytes } from "@/platform/adapters/media-storage";
afterEach(() => { vi.unstubAllGlobals(); sign.mockReset(); });

it("reads only a valid private reference through a short-lived server-only URL", async () => {
  sign.mockResolvedValue({data:{signedUrl:"https://storage.example.invalid/private"},error:null});
  const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1,2,3])));
  vi.stubGlobal("fetch", fetcher);
  expect(await readPrivateMediaBytes("private-evidence/rq_synthetic/thermostat_photo/image.png")).toEqual(Buffer.from([1,2,3]));
  expect(sign).toHaveBeenCalledWith("rq_synthetic/thermostat_photo/image.png",60);
  expect(await readPrivateMediaBytes("https://other.invalid/image.png")).toBeNull();
  expect(await readPrivateMediaBytes("private-evidence/../thermostat_photo/image.png")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("keeps unavailable or oversized storage content out of rendered packets", async () => {
  const ref = "private-evidence/rq_synthetic/thermostat_photo/image.png";
  sign.mockResolvedValue({data:null,error:{message:"unavailable"}});
  const fetcher = vi.fn(); vi.stubGlobal("fetch",fetcher);
  expect(await readPrivateMediaBytes(ref)).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  sign.mockResolvedValue({data:{signedUrl:"https://storage.example.invalid/private"},error:null});
  fetcher.mockResolvedValue(new Response("too large",{headers:{"content-length":"999999999"}}));
  expect(await readPrivateMediaBytes(ref)).toBeNull();
});
