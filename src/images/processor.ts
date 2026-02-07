/**
 * Image processor — on-the-fly image resize, crop, and format conversion.
 *
 * Uses Sharp for high-performance image manipulation.
 * Validates requested dimensions against the configured allowed_sizes.
 *
 * v0.2: Addresses the image processing TODO from markdown.ts.
 */

export interface ImageProcessingOptions {
  /** Target width in pixels */
  width?: number;
  /** Target height in pixels */
  height?: number;
  /** Output quality 1-100 (default from config: 80) */
  quality?: number;
  /** Output format (default: preserve original) */
  format?: ImageOutputFormat;
  /** Resize fit mode (default: "cover") */
  fit?: ImageFit;
  /** Focal point for crop: [x%, y%] — e.g. [50, 30] for center-top */
  focal?: [number, number];
}

export type ImageOutputFormat = "jpeg" | "png" | "webp" | "avif";
export type ImageFit = "cover" | "contain" | "fill" | "inside" | "outside";

export interface ProcessedImage {
  /** Processed image bytes */
  data: Uint8Array;
  /** MIME type of the output */
  contentType: string;
  /** Output width */
  width: number;
  /** Output height */
  height: number;
  /** Output format */
  format: ImageOutputFormat;
}

export interface ImageProcessorConfig {
  /** Default output quality (1-100) */
  defaultQuality: number;
  /** Allowed widths/heights — requests outside these are rejected */
  allowedSizes: number[];
}

/**
 * Create an image processor with the given config.
 */
export function createImageProcessor(config: ImageProcessorConfig) {
  /**
   * Process an image according to the given options.
   * Returns null if the options are invalid (e.g. disallowed size).
   */
  async function process(
    input: Uint8Array,
    options: ImageProcessingOptions,
  ): Promise<ProcessedImage | null> {
    // Validate dimensions against allowed sizes
    if (options.width && !isAllowedSize(options.width)) {
      return null;
    }
    if (options.height && !isAllowedSize(options.height)) {
      return null;
    }

    // Lazy-load Sharp
    const sharp = (await import("sharp")).default;

    let pipeline = sharp(input);

    // Get original metadata for format detection
    const metadata = await pipeline.metadata();
    const originalFormat = metadata.format as string | undefined;

    // Resize if dimensions specified
    if (options.width || options.height) {
      const fit = options.fit ?? "cover";

      const resizeOptions: Record<string, unknown> = {
        width: options.width,
        height: options.height,
        fit,
        withoutEnlargement: true,
      };

      // Apply focal point if using cover fit
      if (options.focal && fit === "cover") {
        resizeOptions.position = `${options.focal[0]}% ${options.focal[1]}%`;
      }

      pipeline = pipeline.resize(resizeOptions as any);
    }

    // Determine output format
    const outputFormat = options.format ?? detectFormat(originalFormat);
    const quality = options.quality ?? config.defaultQuality;

    // Apply format conversion with quality
    switch (outputFormat) {
      case "jpeg":
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
        break;
      case "png":
        pipeline = pipeline.png({ quality });
        break;
      case "webp":
        pipeline = pipeline.webp({ quality });
        break;
      case "avif":
        pipeline = pipeline.avif({ quality });
        break;
    }

    // Execute pipeline
    const result = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      data: new Uint8Array(result.data),
      contentType: formatToMime(outputFormat),
      width: result.info.width,
      height: result.info.height,
      format: outputFormat,
    };
  }

  /**
   * Generate srcset variants for responsive images.
   * Returns an array of processed images at each allowed breakpoint
   * that is smaller than the original.
   */
  async function generateSrcset(
    input: Uint8Array,
    options: Omit<ImageProcessingOptions, "width" | "height"> = {},
  ): Promise<ProcessedImage[]> {
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(input).metadata();
    const originalWidth = metadata.width ?? 0;

    const variants: ProcessedImage[] = [];

    for (const width of config.allowedSizes) {
      if (width >= originalWidth) continue;

      const result = await process(input, { ...options, width });
      if (result) {
        variants.push(result);
      }
    }

    return variants;
  }

  /**
   * Check if a size is in the allowed sizes list.
   */
  function isAllowedSize(size: number): boolean {
    return config.allowedSizes.includes(size);
  }

  /**
   * Parse image processing options from URL query parameters.
   * Returns null if no image params are present.
   */
  function parseOptions(
    params: URLSearchParams,
  ): ImageProcessingOptions | null {
    const width = params.get("width") ?? params.get("w");
    const height = params.get("height") ?? params.get("h");
    const quality = params.get("quality") ?? params.get("q");
    const format = params.get("format") ?? params.get("f");
    const fit = params.get("fit");
    const focal = params.get("focal");

    // No image processing params present
    if (!width && !height && !quality && !format) {
      return null;
    }

    const options: ImageProcessingOptions = {};

    if (width) options.width = parseInt(width, 10);
    if (height) options.height = parseInt(height, 10);
    if (quality) options.quality = parseInt(quality, 10);
    if (format && isValidFormat(format)) options.format = format as ImageOutputFormat;
    if (fit && isValidFit(fit)) options.fit = fit as ImageFit;
    if (focal) {
      const parts = focal.split(",").map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        options.focal = [parts[0], parts[1]];
      }
    }

    // Validate parsed values
    if (options.width !== undefined && (isNaN(options.width) || options.width <= 0)) {
      return null;
    }
    if (options.height !== undefined && (isNaN(options.height) || options.height <= 0)) {
      return null;
    }
    if (options.quality !== undefined && (isNaN(options.quality) || options.quality < 1 || options.quality > 100)) {
      return null;
    }

    return options;
  }

  return { process, generateSrcset, isAllowedSize, parseOptions };
}

export type ImageProcessor = ReturnType<typeof createImageProcessor>;

// === Helpers ===

function detectFormat(sharpFormat: string | undefined): ImageOutputFormat {
  switch (sharpFormat) {
    case "jpeg":
    case "jpg":
      return "jpeg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "avif":
      return "avif";
    default:
      return "jpeg";
  }
}

function formatToMime(format: ImageOutputFormat): string {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
  }
}

function isValidFormat(s: string): s is ImageOutputFormat {
  return ["jpeg", "png", "webp", "avif"].includes(s);
}

function isValidFit(s: string): s is ImageFit {
  return ["cover", "contain", "fill", "inside", "outside"].includes(s);
}
