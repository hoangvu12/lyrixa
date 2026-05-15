export const providerTimeouts = {
  lrcCx: {
    fast: 1000,
    background: 1000
  },
  lyricsPlus: {
    fast: 3000,
    background: 9000
  },
  simpMusic: {
    fast: 1000,
    background: 1000
  },
  lrclibExact: {
    fast: 8000,
    background: 15000
  },
  lrclibSearch: {
    fast: 3500,
    background: 15000
  },
  qqMusic: {
    fast: 1000,
    background: 2000
  },
  plainFallback: {
    fast: 2500,
    background: 8000
  }
} as const;
