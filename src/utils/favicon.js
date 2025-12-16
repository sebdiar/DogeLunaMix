export function getFaviconUrl(url) {
  if (!url || url.startsWith('luna://') || url.startsWith('doge://')) {
    return null;
  }
  
  try {
    const urlObj = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
  } catch {
    return null;
  }
}














