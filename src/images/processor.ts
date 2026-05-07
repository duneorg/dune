/**
 * Image processor — on-the-fly image resize, crop, and format conversion.
 *
 * Uses Sharp for high-performance image manipulation.
 * Validates requested dimensions against the configured allowed_sizes.
 *
 * v0.2: Addresses the image processing TODO from markdown.ts.
 */

/**
 * Hard cap on input bytes handed to sharp. 25 MiB is generous for any
 * supported format; pixel-bomb files (small compressed payload, huge
 * decoded dimensions) are caught separately by sharp's `limitInputPixels`.
 *
 * Refs: claudedocs/security-audit-2026-05.md MED-17 (CWE-400).
 */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/**
 * Hard cap on decoded pixels (width * height * channels-equivalent).
 * 24M ≈ a 6000×4000 image; large enough for legitimate photography but
 * blocks the classic 100k×100k pixel-bomb attack.
 */
const MAX_INPUT_PIXELS = 24_000_000;

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

export interface ImageProcessor {
  process(input: Uint8Array, options: ImageProcessingOptions): Promise<ProcessedImage | null>;
  generateSrcset(input: Uint8Array, options?: Omit<ImageProcessingOptions, "width" | "height">): Promise<ProcessedImage[]>;
  isAllowedSize(size: number): boolean;
  parseOptions(params: URLSearchParams): ImageProcessingOptions | null;
}

/**
 * Create an image processor with the given config.
 */
export function createImageProcessor(config: ImageProcessorConfig): ImageProcessor {
  /**
   * Process an image according to the given options.
   * Returns null if the options are invalid (e.g. disallowed size).
   */
  async function process(
    input: Uint8Array,
    options: ImageProcessingOptions,
  ): Promise<ProcessedImage | null> {
    // Refuse oversized inputs before sharp allocates.
    if (input.byteLength > MAX_INPUT_BYTES) {
      return null;
    }

    // Validate dimensions against allowed sizes
    if (options.width && !isAllowedSize(options.width)) {
      return null;
    }
    if (options.height && !isAllowedSize(options.height)) {
      return null;
    }

    // Lazy-load Sharp
    const sharp = (await import("sharp")).default;

    // limitInputPixels protects against decoded pixel bombs (CWE-400).
    // failOn:"truncated" rejects malformed inputs early instead of producing
    // partial output. unlimited:false keeps libvips memory bounded.
    let pipeline = sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "truncated",
      unlimited: false,
    });

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
    if (input.byteLength > MAX_INPUT_BYTES) {
      return [];
    }
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "truncated",
      unlimited: false,
    }).metadata();
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
      if (
        parts.length === 2 &&
        !isNaN(parts[0]) && !isNaN(parts[1]) &&
        parts[0] >= 0 && parts[0] <= 100 &&
        parts[1] >= 0 && parts[1] <= 100
      ) {
        options.focal = [parts[0], parts[1]];
      }
      // Invalid focal values are silently ignored (safe default: center crop)
    }

    // Maximum dimension cap — prevents allocation of absurdly large images
    // that could exhaust memory.
    const MAX_IMAGE_DIMENSION = 4096;

    // Validate parsed values
    if (options.width !== undefined && (isNaN(options.width) || options.width <= 0)) {
      return null;
    }
    if (options.width !== undefined && options.width > MAX_IMAGE_DIMENSION) {
      options.width = MAX_IMAGE_DIMENSION;
    }
    if (options.height !== undefined && (isNaN(options.height) || options.height <= 0)) {
      return null;
    }
    if (options.height !== undefined && options.height > MAX_IMAGE_DIMENSION) {
      options.height = MAX_IMAGE_DIMENSION;
    }
    if (options.quality !== undefined && (isNaN(options.quality) || options.quality < 1 || options.quality > 100)) {
      return null;
    }

    return options;
  }

  return { process, generateSrcset, isAllowedSize, parseOptions };
}


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
