# Phase 3B preview upload and rollback

Status: prepared locally only. Upload is not authorized.

## Preconditions

1. Obtain explicit upload approval.
2. Create a new directory such as `/winlew-3b-review/`. Do not overwrite,
   rename, or edit `/winlew-3a-review/`.
3. Enable Network Solutions Password Protected Directory access for the new
   directory before uploading any preview file.
4. Confirm anonymous HTTPS access returns `401` before testing credentials.

## Upload

Upload only `index.html`, `views.html`, `homepage.css`, `homepage.js`,
`adapters.js`, `phase2-prototype/app.js`,
`phase2-prototype/styles.css`, and `.htaccess` to the new
protected directory. Do not upload this instruction file, the integrity
manifest, audit reports, screenshots, test harnesses, backend files, or
credentials. Do not add navigation, sitemap, canonical, redirect, or root-page
references to the preview.

After upload, verify:

- anonymous request is `401`;
- authenticated page includes `noindex,nofollow` and the X-Robots-Tag header;
- exactly one `/verify/api-proxy.php?path=/api/homepage/summary` request occurs;
- no direct calls to the nine legacy source paths occur;
- no console errors, mixed content, authentication, wallet, claim, vote, or
  mutation requests occur;
- stale and unavailable states remain visibly distinct from live state.

Stop after recording evidence. Public integration requires a separate approval.

## Rollback

Delete or rename only the newly created `/winlew-3b-review/` directory through
the hosting file manager. Do not touch Phase 3A, the root homepage, proxy,
backend, authentication, games, rewards, governance, or shared assets. Confirm
the removed URL returns `404` or `401` and Phase 3A remains unchanged.
