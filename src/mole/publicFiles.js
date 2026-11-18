// Shared public-file boundary. Application stores are never served from here.
// Keep this independent of credential contents and of test isolation switches.
export function isPublicRequestPath(requestPath) {
  let decoded;
  try { decoded = decodeURIComponent(String(requestPath).split('?')[0]); }
  catch { return false; }
  decoded = decoded.replaceAll('\\', '/');
  const parts = decoded.split('/');
  return !parts.some(part => part === '..' || part.startsWith('.')
    || /^(?:log|\.tmp-audit)$/i.test(part)
    || /^(?:api-proxy-secret|api-proxy-upstream)\.php$/i.test(part)
    || /\.(?:bak|before|patch)$/i.test(part));
}
