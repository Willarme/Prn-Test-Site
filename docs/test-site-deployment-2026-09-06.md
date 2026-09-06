# Test-site deployment — September 6, 2026

The requested noindex preview is available at
[prn-test-site.vercel.app/demo](https://prn-test-site.vercel.app/demo).

Vercel successfully deployed commit `56cf635aaf0a88a5ec2c64fff4a2a8ff868f4c0a`
through the existing GitHub connection. Its application source is the verified
`f8c6740` snapshot; the deployment commit changes only hosting configuration.
The unique deployment is
[prn-test-site-ah19k3pjv-soul-tech-team.vercel.app](https://prn-test-site-ah19k3pjv-soul-tech-team.vercel.app).

Live checks returned 200 for `/demo`, `/demo/all`, the AC door, overview and Provider
OS concepts, `/robots.txt` and `/start`. Every checked response carries
`X-Robots-Tag: noindex, nofollow`; robots.txt disallows all crawling. The added global
header covers raw concept routes that do not inherit application metadata.

Automatic Git deployments are paused again after this successful release. The
pause does not remove the deployed preview. Future source-only pushes should retain
it until another release is explicitly requested.

This verifies hosted pages, not completed hosted intake, synthetic sample creation,
durable sharing, live AI or generated PDF. Those runtime paths need their own storage,
secret, capability and Chrome configuration and verification. No private local
runtime state or new model credentials were uploaded. The generated SEO draft stays
rejected, illustrated feature services remain concepts, and the parallel admin and
audit-repair changes are not included in this deployed snapshot.
