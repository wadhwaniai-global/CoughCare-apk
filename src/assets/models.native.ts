/**
 * ONNX Model Assets Registry (React Native only)
 *
 * This file is only loaded on React Native platforms.
 * Web serves the same model from public/models/ instead.
 *
 * One graph does everything: raw 16 kHz audio in, cough probability out. The
 * older two-model chain (cough_preprocessing.onnx + cough_detector_int8.onnx)
 * is gone; see the history note at the top of src/utils/onnxInference.ts.
 *
 * The path must point at a file prepared by `npm run prepare:model`. An
 * unprepared export cannot be fed its length input on Android, and
 * onnxInference.ts refuses to start rather than score every recording on the
 * wrong pooling rule. Metro requires a static literal here, so swapping the
 * model means editing this line plus the DETECTOR block in onnxInference.ts.
 */

export const MODEL_ASSETS = {
  detector: require('../../assets/models/CED/CED_int8.app.onnx'),
};
