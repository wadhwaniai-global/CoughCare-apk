"use strict";
// evaluate_app_pipeline.ts
/**
 * Evaluation pipeline for React Native app using app's ONNX inference logic.
 *
 * This script validates that the app produces exact results matching evaluate_full_pipeline.ts
 * by using the same inference logic as the app (from onnxInference.ts).
 *
 * FULL ONNX Pipeline (Preprocessing + Detection) on test set:
 * Audio -> Preprocessing ONNX -> Spectrogram -> Detection ONNX -> Prediction
 *
 * Outputs:
 * - outputs/app_pipeline_evaluation_results.json
 * - outputs/app_pipeline_test_results.json
 * - outputs/app_pipeline_plots.png (ROC, PR, prob histograms)  [optional]
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
// @ts-ignore - Allow missing type declarations
const ort = __importStar(require("onnxruntime-node"));
// @ts-ignore
const sync_1 = require("csv-parse/sync");
// @ts-ignore
const yargs_1 = __importDefault(require("yargs"));
// @ts-ignore
const helpers_1 = require("yargs/helpers");
// Optional plots (Chart.js)
let ChartJSNodeCanvas = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ChartJSNodeCanvas = require("chartjs-node-canvas").ChartJSNodeCanvas;
}
catch {
    // plots disabled if not installed
}
/** -------------------- Config -------------------- */
class Config {
    constructor() {
        // Paths
        this.baseDir = String.raw `d:\coughcare_waig_3\Dataset`;
        this.testCsv = String.raw `d:\coughcare_waig_3\Cough\splits\test.csv`;
        this.outputDir = String.raw `d:\coughcare_waig_3\Cough\outputs`;
        // Models
        this.preprocessingModelPath = String.raw `d:\coughcare_waig_3\coughcare_waig 3\cough_preprocessing.onnx`;
        this.detectionModelPath = String.raw `d:\coughcare_waig_3\coughcare_waig 3\cough_detector_int8.onnx`;
        // Audio
        this.sampleRate = 16000;
        this.segmentDuration = 2.0;
        this.hopLength = 0.5;
        this.maxSegmentsPerFile = 32;
        this.segmentSamples = Math.floor(this.sampleRate * this.segmentDuration); // 32000
    }
}
/** -------------------- Utils / Metrics -------------------- */
function ensureDir(p) {
    if (!fs_1.default.existsSync(p))
        fs_1.default.mkdirSync(p, { recursive: true });
}
function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
}
function logLoss(yTrue, yProb, eps = 1e-7) {
    let sum = 0;
    for (let i = 0; i < yTrue.length; i++) {
        const p = clamp(yProb[i], eps, 1 - eps);
        sum += yTrue[i] * Math.log(p) + (1 - yTrue[i]) * Math.log(1 - p);
    }
    return -sum / yTrue.length;
}
function accuracyScore(yTrue, yPred) {
    let c = 0;
    for (let i = 0; i < yTrue.length; i++)
        if (yTrue[i] === yPred[i])
            c++;
    return c / yTrue.length;
}
function f1Score(yTrue, yPred) {
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < yTrue.length; i++) {
        if (yPred[i] === 1 && yTrue[i] === 1)
            tp++;
        else if (yPred[i] === 1 && yTrue[i] === 0)
            fp++;
        else if (yPred[i] === 0 && yTrue[i] === 1)
            fn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}
/**
 * ROC curve + AUC (matches sklearn roc_curve + roc_auc_score)
 * Returns fpr[], tpr[], thresholds[]
 */
function rocCurve(yTrue, yScore) {
    // Sort by descending score
    const idx = yScore.map((s, i) => i).sort((a, b) => yScore[b] - yScore[a]);
    const P = yTrue.reduce((a, b) => a + b, 0);
    const N = yTrue.length - P;
    let tp = 0;
    let fp = 0;
    let prevScore = null;
    const tpr = [];
    const fpr = [];
    const thresholds = [];
    // sklearn includes an initial point (0,0) at threshold = inf
    tpr.push(0);
    fpr.push(0);
    thresholds.push(Number.POSITIVE_INFINITY);
    for (const i of idx) {
        const score = yScore[i];
        const label = yTrue[i];
        if (prevScore !== null && score !== prevScore) {
            tpr.push(P > 0 ? tp / P : 0);
            fpr.push(N > 0 ? fp / N : 0);
            thresholds.push(prevScore);
        }
        if (label === 1)
            tp++;
        else
            fp++;
        prevScore = score;
    }
    // final point
    tpr.push(P > 0 ? tp / P : 0);
    fpr.push(N > 0 ? fp / N : 0);
    thresholds.push(prevScore ?? -Infinity);
    return { fpr, tpr, thresholds };
}
function aucFromCurve(x, y) {
    // trapezoidal rule assuming x sorted ascending (ROC fpr is ascending by construction)
    let area = 0;
    for (let i = 1; i < x.length; i++) {
        area += (x[i] - x[i - 1]) * (y[i] + y[i - 1]) * 0.5;
    }
    return area;
}
/**
 * Precision-Recall curve + AP (average precision, sklearn-style)
 * sklearn's average_precision_score is the area under PR using a step function.
 */
function precisionRecallCurve(yTrue, yScore) {
    const idx = yScore.map((s, i) => i).sort((a, b) => yScore[b] - yScore[a]);
    const P = yTrue.reduce((a, b) => a + b, 0);
    let tp = 0;
    let fp = 0;
    const precision = [];
    const recall = [];
    const thresholds = [];
    let prevScore = null;
    for (const i of idx) {
        const score = yScore[i];
        const label = yTrue[i];
        if (prevScore !== null && score !== prevScore) {
            const prec = tp + fp > 0 ? tp / (tp + fp) : 1;
            const rec = P > 0 ? tp / P : 0;
            precision.push(prec);
            recall.push(rec);
            thresholds.push(prevScore);
        }
        if (label === 1)
            tp++;
        else
            fp++;
        prevScore = score;
    }
    // last point
    const prec = tp + fp > 0 ? tp / (tp + fp) : 1;
    const rec = P > 0 ? tp / P : 0;
    precision.push(prec);
    recall.push(rec);
    thresholds.push(prevScore ?? -Infinity);
    return { precision, recall, thresholds };
}
function averagePrecision(yTrue, yScore) {
    // Step-function integral (sklearn-like):
    // AP = sum_n (R_n - R_{n-1}) * P_n
    const { precision, recall } = precisionRecallCurve(yTrue, yScore);
    // Ensure recall is non-decreasing (it should be)
    let ap = 0;
    let prevRecall = 0;
    for (let i = 0; i < precision.length; i++) {
        const r = recall[i];
        const p = precision[i];
        ap += (r - prevRecall) * p;
        prevRecall = r;
    }
    return ap;
}
function classificationReport(yTrue, yPred) {
    // Binary report similar to sklearn classification_report for labels 0/1
    const labels = [0, 1];
    const rows = {};
    for (const c of labels) {
        let tp = 0, fp = 0, fn = 0, support = 0;
        for (let i = 0; i < yTrue.length; i++) {
            if (yTrue[i] === c)
                support++;
            if (yPred[i] === c && yTrue[i] === c)
                tp++;
            if (yPred[i] === c && yTrue[i] !== c)
                fp++;
            if (yPred[i] !== c && yTrue[i] === c)
                fn++;
        }
        const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
        const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        rows[c] = { precision, recall, f1, support };
    }
    const total = yTrue.length;
    const macro = {
        precision: (rows[0].precision + rows[1].precision) / 2,
        recall: (rows[0].recall + rows[1].recall) / 2,
        f1: (rows[0].f1 + rows[1].f1) / 2,
        support: total,
    };
    const weighted = {
        precision: (rows[0].precision * rows[0].support + rows[1].precision * rows[1].support) / total,
        recall: (rows[0].recall * rows[0].support + rows[1].recall * rows[1].support) / total,
        f1: (rows[0].f1 * rows[0].support + rows[1].f1 * rows[1].support) / total,
        support: total,
    };
    return { rows, macro, weighted };
}
function fmt4(x) {
    return x.toFixed(4);
}
/** -------------------- Audio Loader (ffmpeg) -------------------- */
class AudioLoader {
    constructor(sampleRate = 16000) {
        this.sampleRate = sampleRate;
    }
    /**
     * Loads audio similar to Python:
     * - decode any file -> mono float32 in [-1,1] (ffmpeg)
     * - resample to target sample rate (ffmpeg)
     *
     * IMPORTANT: we DO NOT do max-abs normalization (matching app logic).
     */
    loadAudio(filePath) {
        // Decode to raw f32le mono at target sample rate.
        // ffmpeg outputs float32 samples typically already scaled in [-1, 1].
        const args = [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            filePath,
            "-ac",
            "1",
            "-ar",
            String(this.sampleRate),
            "-f",
            "f32le",
            "pipe:1",
        ];
        const res = (0, child_process_1.spawnSync)("ffmpeg", args, { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
        if (res.status !== 0 || !res.stdout) {
            const err = res.stderr ? res.stderr.toString("utf8") : "";
            throw new Error(`ffmpeg decode failed for ${filePath}: ${err}`);
        }
        const buf = res.stdout;
        // Interpret as float32 little-endian
        const floatCount = Math.floor(buf.length / 4);
        const out = new Float32Array(floatCount);
        for (let i = 0; i < floatCount; i++)
            out[i] = buf.readFloatLE(i * 4);
        return out;
    }
}
/** -------------------- ONNX Inference Pipeline (App Logic) -------------------- */
class ONNXInferencePipeline {
    constructor(preprocessingPath, modelPath) {
        this.sampleRate = 16000;
        this.segmentDuration = 2.0;
        this.hopLength = 0.5;
        this.maxSegments = 32;
        this.segmentSamples = Math.floor(this.sampleRate * this.segmentDuration); // 32000
        this.preprocessSession = ort.InferenceSession.create(preprocessingPath, {
            executionProviders: ["cpu"],
        });
        this.modelSession = ort.InferenceSession.create(modelPath, {
            executionProviders: ["cpu"],
        });
    }
    /**
     * Extract segments - matches app's extractSegments() exactly
     */
    extractSegments(waveform) {
        const segSamples = this.segmentSamples;
        const hopSamples = Math.floor(this.hopLength * this.sampleRate);
        // Pad if too short (matching app logic)
        let w = waveform;
        if (w.length < segSamples) {
            const padded = new Float32Array(segSamples);
            padded.set(w);
            w = padded; // zero pad end
        }
        const segments = [];
        let start = 0;
        while (start + segSamples <= w.length) {
            segments.push(w.slice(start, start + segSamples));
            start += hopSamples;
        }
        // Ensure at least one segment
        if (segments.length === 0) {
            segments.push(w.slice(0, segSamples));
        }
        // Cap at max segments (matching app logic)
        if (segments.length > this.maxSegments) {
            return segments.slice(0, this.maxSegments);
        }
        return segments;
    }
    /**
     * Preprocess segment - matches app's preprocessSegment() exactly
     */
    async preprocessSegment(segment) {
        // Create input tensor: [1, segment_samples] float32 (matching app)
        const input = new ort.Tensor("float32", segment, [1, segment.length]);
        const results = await (await this.preprocessSession).run({ waveform: input });
        // Get output: [1, 3, 224, 224] flattened
        // Python returns outputs[0] without relying on name
        const key = Object.keys(results)[0];
        if (!key)
            throw new Error("Preprocessing ONNX returned no outputs");
        const out = results[key];
        return out.data; // expected [1,3,224,224] flattened
    }
    /**
     * Predict - matches app's detectCough() logic exactly
     * CRITICAL: NO padding to 32! Use actual numSegments for both tensor and mask.
     */
    async predict(waveform) {
        const segments = this.extractSegments(waveform);
        const numSegments = segments.length;
        if (numSegments === 0)
            return { bagProb: 0.0, segProbs: [], numSeg: 0 };
        // Preprocess each segment
        const spectrograms = [];
        for (const seg of segments) {
            spectrograms.push(await this.preprocessSegment(seg));
        }
        // Stack like app:
        // specs_batch = concatenate(spectrograms, axis=0) => (numSeg,3,224,224)
        // Then expand dims => (1,numSeg,3,224,224)
        const specSize = spectrograms[0].length; // should be 3*224*224
        const stacked = new Float32Array(numSegments * specSize);
        for (let i = 0; i < numSegments; i++)
            stacked.set(spectrograms[i], i * specSize);
        const specsTensor = new ort.Tensor("float32", stacked, [1, numSegments, 3, 224, 224]);
        // Python mask: np.ones((1,numSeg), dtype=bool)
        // Mask length = numSegments (NOT 32), all true - matching app logic
        const maskData = new Uint8Array(numSegments);
        maskData.fill(1);
        const maskTensor = new ort.Tensor("bool", maskData, [1, numSegments]);
        // Python feeds exact names: {'spectrograms': specs_batch, 'segment_mask': mask}
        const model = await this.modelSession;
        let outputs = {};
        try {
            outputs = (await model.run({
                spectrograms: specsTensor,
                segment_mask: maskTensor,
            }));
        }
        catch (e) {
            // Fallback if model uses different names
            const inputNames = model.inputNames ?? model.getInputs?.().map((x) => x.name) ?? [];
            const inputs = {};
            for (const name of inputNames) {
                const n = String(name).toLowerCase();
                if (n.includes("spectrogram") || n === "x" || n.includes("input"))
                    inputs[name] = specsTensor;
                else if (n.includes("mask"))
                    inputs[name] = maskTensor;
            }
            outputs = (await model.run(inputs));
        }
        // Python expects:
        // bag_prob = float(outputs[0][0])
        // seg_probs = outputs[1][0][:numSeg]
        const keys = Object.keys(outputs);
        if (keys.length < 1)
            throw new Error("Detector ONNX returned no outputs");
        // bag prob = first output's first element
        const out0 = outputs[keys[0]].data;
        const bagProb = Number(out0[0]);
        let segProbs = [];
        if (keys.length >= 2) {
            const out1 = outputs[keys[1]].data;
            // Python: outputs[1][0][:numSeg] — many exported models flatten; we take first numSeg.
            segProbs = Array.from(out1).slice(0, numSegments).map(Number);
        }
        return { bagProb, segProbs, numSeg: numSegments };
    }
}
class AppPipelineEvaluator {
    constructor(config) {
        this.config = config;
        this.loader = new AudioLoader(config.sampleRate);
        console.log("Initializing App ONNX Pipeline (matching app logic)...");
        console.log("  Preprocessing:", config.preprocessingModelPath);
        console.log("  Detection:", config.detectionModelPath);
        this.pipeline = new ONNXInferencePipeline(config.preprocessingModelPath, config.detectionModelPath);
    }
    loadTestData() {
        const csvText = fs_1.default.readFileSync(this.config.testCsv, "utf8");
        const rows = (0, sync_1.parse)(csvText, { columns: true, skip_empty_lines: true });
        const out = [];
        for (const r of rows) {
            const file_path = r["file_path"];
            const cough_label = String(r["cough_label"] ?? "").toLowerCase();
            const label = cough_label === "true" ? 1 : 0;
            const audio_path = path_1.default.join(this.config.baseDir, file_path);
            out.push({ file_path, audio_path, label });
        }
        return out;
    }
    async evaluate(savePlots = true) {
        console.log("\n" + "=".repeat(60));
        console.log("APP ONNX PIPELINE EVALUATION");
        console.log("=".repeat(60));
        let testData = this.loadTestData();
        console.log(`\nTest set size: ${testData.length} samples`);
        const allProbs = [];
        const allLabels = [];
        const allSegProbs = [];
        const failedFiles = [];
        console.log("\nRunning Inference...");
        for (let i = 0; i < testData.length; i++) {
            const item = testData[i];
            try {
                const waveform = this.loader.loadAudio(item.audio_path);
                const { bagProb, segProbs } = await this.pipeline.predict(waveform);
                allProbs.push(bagProb);
                allLabels.push(item.label);
                allSegProbs.push(...segProbs);
            }
            catch (e) {
                console.error(`\nError processing ${item.file_path}: ${e?.message ?? String(e)}`);
                failedFiles.push(item.file_path);
            }
            // crude progress
            if ((i + 1) % 50 === 0 || i + 1 === testData.length) {
                process.stdout.write(`\rProcessed ${i + 1}/${testData.length}`);
            }
        }
        console.log("");
        if (failedFiles.length) {
            console.log(`\nWarning: ${failedFiles.length} files failed to process`);
        }
        this.calculateAndPrintMetrics(allLabels, allProbs, allSegProbs, savePlots);
    }
    async createPlots(yTrue, yProb, segProb, optimalThresh, auc, ap, outPath) {
        if (!ChartJSNodeCanvas) {
            console.log("Plots skipped (install chartjs-node-canvas to enable).");
            return;
        }
        const { fpr, tpr } = rocCurve(yTrue, yProb);
        const pr = precisionRecallCurve(yTrue, yProb);
        const width = 1200;
        const height = 900;
        const canvas = new ChartJSNodeCanvas({ width, height, backgroundColour: "white" });
        const configuration = {
            type: "line",
            data: {
                datasets: [
                    {
                        label: `ROC (AUC=${auc.toFixed(3)})`,
                        data: fpr.map((x, i) => ({ x, y: tpr[i] })),
                        parsing: false,
                    },
                    {
                        label: `PR (AP=${ap.toFixed(3)})`,
                        data: pr.recall.map((x, i) => ({ x, y: pr.precision[i] })),
                        parsing: false,
                    },
                ],
            },
            options: {
                responsive: false,
                plugins: { title: { display: true, text: "App ONNX Pipeline Evaluation (ROC + PR)" } },
                scales: {
                    x: { type: "linear", min: 0, max: 1, title: { display: true, text: "X" } },
                    y: { type: "linear", min: 0, max: 1, title: { display: true, text: "Y" } },
                },
            },
        };
        const image = await canvas.renderToBuffer(configuration);
        fs_1.default.writeFileSync(outPath, image);
    }
    calculateAndPrintMetrics(yTrue, yProb, segProb, savePlots) {
        console.log("\nCalculating metrics...");
        const { fpr, tpr } = rocCurve(yTrue, yProb);
        const auc = aucFromCurve(fpr, tpr);
        const ap = averagePrecision(yTrue, yProb);
        const testLoss = logLoss(yTrue, yProb, 1e-7);
        // Threshold analysis (same thresholds list as python)
        const thresholds = [0.3, 0.4, 0.5, 0.6, 0.7];
        const thresholdResults = {};
        for (const thresh of thresholds) {
            const preds = yProb.map((p) => (p > thresh ? 1 : 0));
            const acc = accuracyScore(yTrue, preds);
            const f1 = f1Score(yTrue, preds);
            let tp = 0, fp = 0, fn = 0, tn = 0;
            for (let i = 0; i < yTrue.length; i++) {
                if (preds[i] === 1 && yTrue[i] === 1)
                    tp++;
                else if (preds[i] === 1 && yTrue[i] === 0)
                    fp++;
                else if (preds[i] === 0 && yTrue[i] === 1)
                    fn++;
                else if (preds[i] === 0 && yTrue[i] === 0)
                    tn++;
            }
            const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
            const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
            const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
            thresholdResults[`threshold_${thresh}`] = {
                accuracy: acc,
                f1_score: f1,
                precision,
                recall,
                specificity,
                true_positives: tp,
                false_positives: fp,
                true_negatives: tn,
                false_negatives: fn,
            };
        }
        // Find optimal threshold by F1 over 0.01..0.99 (99 points) like python
        const testThresholds = [];
        for (let i = 1; i <= 99; i++)
            testThresholds.push(i / 100);
        const f1s = testThresholds.map((t) => f1Score(yTrue, yProb.map((p) => (p > t ? 1 : 0))));
        let optimalIdx = 0;
        for (let i = 1; i < f1s.length; i++)
            if (f1s[i] > f1s[optimalIdx])
                optimalIdx = i;
        const optimalThresh = testThresholds[optimalIdx];
        const optimalF1 = f1s[optimalIdx];
        const optimalPreds = yProb.map((p) => (p > optimalThresh ? 1 : 0));
        const optimalAcc = accuracyScore(yTrue, optimalPreds);
        const report = classificationReport(yTrue, optimalPreds);
        console.log("\n" + "=".repeat(60));
        console.log("APP PIPELINE RESULTS");
        console.log("=".repeat(60));
        console.log(`AUC: ${fmt4(auc)}`);
        console.log(`AP: ${fmt4(ap)}`);
        console.log(`Test Loss: ${fmt4(testLoss)}`);
        console.log(`Optimal Threshold: ${optimalThresh.toFixed(3)}`);
        console.log(`F1 Score: ${fmt4(optimalF1)}`);
        console.log(`Accuracy: ${fmt4(optimalAcc)}`);
        console.log("\nClassification Report:");
        console.log([
            "              precision    recall  f1-score   support",
            `No Cough      ${report.rows[0].precision.toFixed(2)}       ${report.rows[0].recall.toFixed(2)}     ${report.rows[0].f1.toFixed(2)}      ${report.rows[0].support}`,
            `Cough         ${report.rows[1].precision.toFixed(2)}       ${report.rows[1].recall.toFixed(2)}     ${report.rows[1].f1.toFixed(2)}      ${report.rows[1].support}`,
            `macro avg     ${report.macro.precision.toFixed(2)}       ${report.macro.recall.toFixed(2)}     ${report.macro.f1.toFixed(2)}      ${report.macro.support}`,
            `weighted avg  ${report.weighted.precision.toFixed(2)}       ${report.weighted.recall.toFixed(2)}     ${report.weighted.f1.toFixed(2)}      ${report.weighted.support}`,
        ].join("\n"));
        ensureDir(this.config.outputDir);
        const positive = yTrue.reduce((a, b) => a + b, 0);
        const evalResults = {
            model_type: "APP_ONNX_PIPELINE",
            preprocessing_model: this.config.preprocessingModelPath,
            detection_model: this.config.detectionModelPath,
            test_set_size: yTrue.length,
            positive_samples: positive,
            negative_samples: yTrue.length - positive,
            class_balance: positive / yTrue.length,
            overall_metrics: {
                test_loss: testLoss,
                auc,
                average_precision: ap,
            },
            threshold_results: thresholdResults,
            optimal_threshold: {
                threshold: optimalThresh,
                f1_score: optimalF1,
                accuracy: optimalAcc,
            },
            segment_analysis: {
                total_segments: segProb.length,
                mean_probability: segProb.length ? segProb.reduce((a, b) => a + b, 0) / segProb.length : 0,
                std_probability: segProb.length > 1
                    ? Math.sqrt(segProb.reduce((s, x) => s + Math.pow(x - segProb.reduce((a, b) => a + b, 0) / segProb.length, 2), 0) /
                        segProb.length)
                    : 0,
                min_probability: segProb.length ? Math.min(...segProb) : 0,
                max_probability: segProb.length ? Math.max(...segProb) : 0,
            },
        };
        const evalPath = path_1.default.join(this.config.outputDir, "app_pipeline_evaluation_results.json");
        fs_1.default.writeFileSync(evalPath, JSON.stringify(evalResults, null, 2));
        console.log(`\nDetailed results saved to: ${evalPath}`);
        const testResults = {
            model_type: "APP_ONNX_PIPELINE",
            test_loss: testLoss,
            test_accuracy: optimalAcc,
            test_auc: auc,
            test_ap: ap,
            optimal_threshold: optimalThresh,
            optimal_f1: optimalF1,
        };
        const testPath = path_1.default.join(this.config.outputDir, "app_pipeline_test_results.json");
        fs_1.default.writeFileSync(testPath, JSON.stringify(testResults, null, 2));
        console.log(`Compact results saved to: ${testPath}`);
        if (savePlots) {
            const plotPath = path_1.default.join(this.config.outputDir, "app_pipeline_plots.png");
            this.createPlots(yTrue, yProb, segProb, optimalThresh, auc, ap, plotPath)
                .then(() => console.log(`Plots saved to: ${plotPath}`))
                .catch((e) => console.log(`Plot creation failed (non-fatal): ${e?.message ?? String(e)}`));
        }
    }
}
/** -------------------- Main -------------------- */
async function main() {
    const argv = await (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
        .option("limit", { type: "number", describe: "Limit number of files for quick testing" })
        .option("no-plots", { type: "boolean", default: false, describe: "Disable plot saving" })
        .help()
        .parse();
    const config = new Config();
    const evaluator = new AppPipelineEvaluator(config);
    // Monkey-patch limit like python
    if (argv.limit) {
        const original = evaluator.loadTestData.bind(evaluator);
        evaluator.loadTestData = () => original().slice(0, argv.limit);
        console.log(`Limiting to first ${argv.limit} samples...`);
    }
    await evaluator.evaluate(!argv["no-plots"]);
}
main().catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
});
