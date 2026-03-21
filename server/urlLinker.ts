export function autoLinkUrls(text: string): string {
  return text.replace(
    /(\[url(?:=[^\]]*)\][\s\S]*?\[\/url\])|(https?:\/\/[^\s<>"'\[\]]+)/gi,
    (match, bbcodeTag) => {
      if (bbcodeTag) {
        return bbcodeTag;
      }
      return `[url]${match}[/url]`;
    }
  );
}
