// Text metrics shared by the AM XML codec and the canvas text renderer.
//
// Everything here is derived from the APK, not from taste:
//
//   TextElementKt.getTextDimensions / getTextPath / getSpaceWidth
//       textPaint.setTextSize(styledText.getFontSize() * 3.0f)
//   TextElementKt.getTextDimensions returns
//       new Vector2D(styledText.getWrapWidth(), staticLayout.getHeight())
//   StyleParams mask constructor
//       letterSpacing default 0.0f, lineSpacing default 1.0f
//
// So one AM `size` unit is three project pixels of em, and the layer box is the
// wrap width by the laid-out line height — not a constant multiple of the size.

/** Project pixels per AM `size` unit. */
export const AM_TEXT_UNIT_PX = 3;

/**
 * Base line box as a multiple of the em.
 *
 * StaticLayout's line height comes from the font's ascent+descent, which is ~1.17em
 * for the fonts AM ships; the renderer uses 1.2em as the standing approximation and
 * multiplies it by AM's `lineSpacing` (default 1.0).
 */
export const AM_TEXT_BASE_LINE_HEIGHT = 1.2;

export function amTextSizeToPx(amSize: number): number {
  return amSize * AM_TEXT_UNIT_PX;
}

export function pxToAmTextSize(px: number): number {
  return px / AM_TEXT_UNIT_PX;
}

/** Height of a laid-out text block, in project pixels. */
export function textBlockHeight(fontSizePx: number, lineCount: number, lineHeight: number): number {
  const lines = Math.max(1, lineCount);
  return fontSizePx * (lineHeight || AM_TEXT_BASE_LINE_HEIGHT) * lines;
}
