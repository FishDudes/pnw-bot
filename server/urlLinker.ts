export function autoLinkUrls(text: string): string {
  return text.replace(
    /(<a\s[^>]*href\s*=\s*["']https?:\/\/[^"']*["'][^>]*>[\s\S]*?<\/a>)|(https?:\/\/[^\s<>"']+)/gi,
    (match, anchorTag) => {
      if (anchorTag) {
        return anchorTag;
      }
      return `<a href="${match}">${match}</a>`;
    }
  );
}
