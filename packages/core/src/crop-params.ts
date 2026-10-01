import { CropName, CropParams } from "@jadal/contracts";
import cropParamsRaw from "./data/crop-params.json";

export const allCropParams: CropParams[] = cropParamsRaw.map((raw) => CropParams.parse(raw));

const cropParamsMap = new Map<string, CropParams>();

for (const params of allCropParams) {
  const key = params.variant ? `${params.crop}:${params.variant}` : params.crop;
  cropParamsMap.set(key, params);
  // Also store default under crop if not already present
  if (!cropParamsMap.has(params.crop)) {
    cropParamsMap.set(params.crop, params);
  }
}

export function getCropParams(crop: CropName, variant?: string): CropParams {
  if (variant) {
    const specific = cropParamsMap.get(`${crop}:${variant}`);
    if (specific) return specific;
  }
  const fallback = cropParamsMap.get(crop);
  if (!fallback) {
    throw new Error(`Crop parameters not found for crop: ${crop}`);
  }
  return fallback;
}
