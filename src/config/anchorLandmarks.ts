import type { AnchorPoint } from "../data/clothes";

export const ANCHOR_LANDMARKS: Record<AnchorPoint, { left: number; right: number }> = {
  shoulders: { left: 11, right: 12 },
  hips: { left: 23, right: 24 },
  feet: { left: 27, right: 28 },   // лодыжки
  head: { left: 7, right: 8 }      // уши (приближённая ширина головы)
};