// The page's last line of defence for AI answers. The Worker already refuses cut-off, malformed or unfinished answers (they
// arrive as errors, never as results). This also refuses anything that is not explicitly marked complete, so an old, cached,
// hand-made or future-format response cannot be shown or saved as an analysis by mistake.
export function acceptFreshAiResult(data) {
  return !!data && data.ok === true && !data.incomplete && !!data.result && data.result.complete === true && data.result.parseError === false;
}
