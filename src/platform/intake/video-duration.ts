import { createFile, MP4BoxBuffer } from "mp4box";

/** Read the complete bounded upload, never a client duration field. Fragmented
 * or incomplete clips are refused when a trustworthy complete duration is not
 * available. Track/sample timing can extend beyond the movie-header duration. */
export function videoDuration(bytes: Buffer): number | null {
  try {
    const file = createFile();
    let failed = false;
    file.onError = () => { failed = true; };
    file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(Uint8Array.from(bytes).buffer, 0), true);
    file.flush();
    if (failed || !file.moov || !file.ftyp) return null;
    const info = file.getInfo();
    if (info.isFragmented || !info.videoTracks.length || !info.timescale || !info.duration) return null;
    const durations = [info.duration / info.timescale];
    for (const track of info.tracks) {
      if (!track.timescale || !track.duration || !track.nb_samples) return null;
      durations.push(track.duration / track.timescale, track.movie_duration / info.timescale);
      const parsed = file.getTrackById(track.id);
      if (!parsed?.samples.length) return null;
      let first = Infinity, last = -Infinity;
      for (const sample of parsed.samples) {
        if (!Number.isSafeInteger(sample.offset) || !Number.isSafeInteger(sample.size) || sample.offset < 0 || sample.size <= 0 || sample.offset + sample.size > bytes.length) return null;
        if (!Number.isFinite(sample.cts) || !Number.isFinite(sample.duration) || sample.duration <= 0) return null;
        first = Math.min(first, sample.cts); last = Math.max(last, sample.cts + sample.duration);
      }
      durations.push((last-first)/track.timescale);
    }
    if (durations.some(d=>!Number.isFinite(d)||d<=0)) return null;
    return Math.max(...durations);
  } catch { return null; }
}
