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

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
// @ts-ignore - Allow missing type declarations
import * as ort from "onnxruntime-node";
// @ts-ignore
import { parse } from "csv-parse/sync";
// @ts-ignore
import yargs from "yargs";
// @ts-ignore
import { hideBin } from "yargs/helpers";

// Optional plots (Chart.js)
let ChartJSNodeCanvas: any = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ChartJSNodeCanvas = require("chartjs-node-canvas").ChartJSNodeCanvas;
} catch {
    // plots disabled if not installed
}

/** -------------------- Config -------------------- */

class Config {
    // Paths
    baseDir = String.raw`d:\coughcare_waig_3\Dataset`;
    testCsv = String.raw`d:\coughcare_waig_3\Cough\splits\test.csv`;
    outputDir = String.raw`d:\coughcare_waig_3\Cough\outputs`;

    // Models
    preprocessingModelPath = String.raw`d:\coughcare_waig_3\coughcare_waig 3\cough_preprocessing.onnx`;
    detectionModelPath = String.raw`d:\coughcare_waig_3\coughcare_waig 3\cough_detector_int8.onnx`;

    // Audio
    sampleRate = 16000;
    segmentDuration = 2.0;
    hopLength = 0.5;
    maxSegmentsPerFile = 32;
    segmentSamples = Math.floor(this.sampleRate * this.segmentDuration); // 32000
}

/** -------------------- Utils / Metrics -------------------- */

function ensureDir(p: string) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function clamp(x: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, x));
}

function logLoss(yTrue: number[], yProb: number[], eps = 1e-7): number {
    let sum = 0;
    for (let i = 0; i < yTrue.length; i++) {
        const p = clamp(yProb[i], eps, 1 - eps);
        sum += yTrue[i] * Math.log(p) + (1 - yTrue[i]) * Math.log(1 - p);
    }
    return -sum / yTrue.length;
}

function accuracyScore(yTrue: number[], yPred: number[]): number {
    let c = 0;
    for (let i = 0; i < yTrue.length; i++) if (yTrue[i] === yPred[i]) c++;
    return c / yTrue.length;
}

function f1Score(yTrue: number[], yPred: number[]): number {
    let tp = 0,
        fp = 0,
        fn = 0;
    for (let i = 0; i < yTrue.length; i++) {
        if (yPred[i] === 1 && yTrue[i] === 1) tp++;
        else if (yPred[i] === 1 && yTrue[i] === 0) fp++;
        else if (yPred[i] === 0 && yTrue[i] === 1) fn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

/**
 * ROC curve + AUC (matches sklearn roc_curve + roc_auc_score)
 * Returns fpr[], tpr[], thresholds[]
 */
function rocCurve(yTrue: number[], yScore: number[]) {
    // Sort by descending score
    const idx = yScore.map((s, i) => i).sort((a, b) => yScore[b] - yScore[a]);
    const P = yTrue.reduce((a, b) => a + b, 0);
    const N = yTrue.length - P;

    let tp = 0;
    let fp = 0;
    let prevScore: number | null = null;

    const tpr: number[] = [];
    const fpr: number[] = [];
    const thresholds: number[] = [];

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
        if (label === 1) tp++;
        else fp++;
        prevScore = score;
    }

    // final point
    tpr.push(P > 0 ? tp / P : 0);
    fpr.push(N > 0 ? fp / N : 0);
    thresholds.push(prevScore ?? -Infinity);

    return { fpr, tpr, thresholds };
}

function aucFromCurve(x: number[], y: number[]): number {
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
function precisionRecallCurve(yTrue: number[], yScore: number[]) {
    const idx = yScore.map((s, i) => i).sort((a, b) => yScore[b] - yScore[a]);
    const P = yTrue.reduce((a, b) => a + b, 0);

    let tp = 0;
    let fp = 0;

    const precision: number[] = [];
    const recall: number[] = [];
    const thresholds: number[] = [];

    let prevScore: number | null = null;

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

        if (label === 1) tp++;
        else fp++;
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

function averagePrecision(yTrue: number[], yScore: number[]): number {
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

function classificationReport(yTrue: number[], yPred: number[]) {
    // Binary report similar to sklearn classification_report for labels 0/1
    const labels = [0, 1] as const;

    type Row = { precision: number; recall: number; f1: number; support: number };
    const rows: Record<number, Row> = {};

    for (const c of labels) {
        let tp = 0,
            fp = 0,
            fn = 0,
            support = 0;
        for (let i = 0; i < yTrue.length; i++) {
            if (yTrue[i] === c) support++;
            if (yPred[i] === c && yTrue[i] === c) tp++;
            if (yPred[i] === c && yTrue[i] !== c) fp++;
            if (yPred[i] !== c && yTrue[i] === c) fn++;
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
        precision:
            (rows[0].precision * rows[0].support + rows[1].precision * rows[1].support) / total,
        recall: (rows[0].recall * rows[0].support + rows[1].recall * rows[1].support) / total,
        f1: (rows[0].f1 * rows[0].support + rows[1].f1 * rows[1].support) / total,
        support: total,
    };

    return { rows, macro, weighted };
}

function fmt4(x: number) {
    return x.toFixed(4);
}

/** -------------------- Audio Loader (ffmpeg) -------------------- */

class AudioLoader {
    constructor(private sampleRate = 16000) { }

    /**
     * Loads audio similar to Python:
     * - decode any file -> mono float32 in [-1,1] (ffmpeg)
     * - resample to target sample rate (ffmpeg)
     *
     * IMPORTANT: we DO NOT do max-abs normalization (matching app logic).
     */
    loadAudio(filePath: string): Float32Array {
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

        const res = spawnSync("ffmpeg", args, { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
        if (res.status !== 0 || !res.stdout) {
            const err = res.stderr ? res.stderr.toString("utf8") : "";
            throw new Error(`ffmpeg decode failed for ${filePath}: ${err}`);
        }

        const buf: Buffer = res.stdout as any;
        // Interpret as float32 little-endian
        const floatCount = Math.floor(buf.length / 4);
        const out = new Float32Array(floatCount);
        for (let i = 0; i < floatCount; i++) out[i] = buf.readFloatLE(i * 4);
        return out;
    }
}

/** -------------------- ONNX Inference Pipeline (App Logic) -------------------- */

class ONNXInferencePipeline {
    preprocessSession: ort.InferenceSession;
    modelSession: ort.InferenceSession;

    sampleRate = 16000;
    segmentDuration = 2.0;
    hopLength = 0.5;
    maxSegments = 32;
    segmentSamples = Math.floor(this.sampleRate * this.segmentDuration); // 32000

    constructor(preprocessingPath: string, modelPath: string) {
        this.preprocessSession = ort.InferenceSession.create(preprocessingPath, {
            executionProviders: ["cpu"],
        }) as any;
        this.modelSession = ort.InferenceSession.create(modelPath, {
            executionProviders: ["cpu"],
        }) as any;
    }

    /**
     * Extract segments - matches app's extractSegments() exactly
     */
    extractSegments(waveform: Float32Array): Float32Array[] {
        const segSamples = this.segmentSamples;
        const hopSamples = Math.floor(this.hopLength * this.sampleRate);

        // Pad if too short (matching app logic)
        let w = waveform;
        if (w.length < segSamples) {
            const padded = new Float32Array(segSamples);
            padded.set(w);
            w = padded; // zero pad end
        }

        const segments: Float32Array[] = [];
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
    async preprocessSegment(segment: Float32Array): Promise<Float32Array> {
        // Create input tensor: [1, segment_samples] float32 (matching app)
        const input = new ort.Tensor("float32", segment, [1, segment.length]);

        const results = await (await this.preprocessSession).run({ waveform: input });

        // Get output: [1, 3, 224, 224] flattened
        // Python returns outputs[0] without relying on name
        const key = Object.keys(results)[0];
        if (!key) throw new Error("Preprocessing ONNX returned no outputs");
        const out = results[key];
        return out.data as Float32Array; // expected [1,3,224,224] flattened
    }

    /**
     * Predict - matches app's detectCough() logic exactly
     * CRITICAL: NO padding to 32! Use actual numSegments for both tensor and mask.
     */
    async predict(waveform: Float32Array): Promise<{ bagProb: number; segProbs: number[]; numSeg: number }> {
        const segments = this.extractSegments(waveform);
        const numSegments = segments.length;
        if (numSegments === 0) return { bagProb: 0.0, segProbs: [], numSeg: 0 };

        // Preprocess each segment
        const spectrograms: Float32Array[] = [];
        for (const seg of segments) {
            spectrograms.push(await this.preprocessSegment(seg));
        }

        // Stack like app:
        // specs_batch = concatenate(spectrograms, axis=0) => (numSeg,3,224,224)
        // Then expand dims => (1,numSeg,3,224,224)
        const specSize = spectrograms[0].length; // should be 3*224*224
        const stacked = new Float32Array(numSegments * specSize);
        for (let i = 0; i < numSegments; i++) stacked.set(spectrograms[i], i * specSize);

        const specsTensor = new ort.Tensor("float32", stacked, [1, numSegments, 3, 224, 224]);

        // Python mask: np.ones((1,numSeg), dtype=bool)
        // Mask length = numSegments (NOT 32), all true - matching app logic
        const maskData = new Uint8Array(numSegments);
        maskData.fill(1);
        const maskTensor = new ort.Tensor("bool", maskData as any, [1, numSegments]);

        // Python feeds exact names: {'spectrograms': specs_batch, 'segment_mask': mask}
        const model = await this.modelSession;
        let outputs: Record<string, any> = {};
        try {
            outputs = (await model.run({
                spectrograms: specsTensor,
                segment_mask: maskTensor,
            })) as any;
        } catch (e) {
            // Fallback if model uses different names
            const inputNames = (model as any).inputNames ?? (model as any).getInputs?.().map((x: any) => x.name) ?? [];
            const inputs: any = {};
            for (const name of inputNames) {
                const n = String(name).toLowerCase();
                if (n.includes("spectrogram") || n === "x" || n.includes("input")) inputs[name] = specsTensor;
                else if (n.includes("mask")) inputs[name] = maskTensor;
            }
            outputs = (await model.run(inputs)) as any;
        }

        // Python expects:
        // bag_prob = float(outputs[0][0])
        // seg_probs = outputs[1][0][:numSeg]
        // In Node, outputs is named; we take first two outputs by order if possible.
        const keys = Object.keys(outputs);
        if (keys.length < 1) throw new Error("Detector ONNX returned no outputs");

        // bag prob = first output's first element
        const out0 = outputs[keys[0]].data as any;
        const bagProb = Number(out0[0]);

        let segProbs: number[] = [];
        if (keys.length >= 2) {
            const out1 = outputs[keys[1]].data as any;
            // Python: outputs[1][0][:numSeg] — many exported models flatten; we take first numSeg.
            segProbs = Array.from(out1 as ArrayLike<number>).slice(0, numSegments).map(Number);
        }

        return { bagProb, segProbs, numSeg: numSegments };
    }
}

/** -------------------- Evaluator -------------------- */

type TestItem = { file_path: string; audio_path: string; label: number };

class AppPipelineEvaluator {
    loader: AudioLoader;
    pipeline: ONNXInferencePipeline;
    constructor(private config: Config) {
        this.loader = new AudioLoader(config.sampleRate);

        console.log("Initializing App ONNX Pipeline (matching app logic)...");
        console.log("  Preprocessing:", config.preprocessingModelPath);
        console.log("  Detection:", config.detectionModelPath);

        this.pipeline = new ONNXInferencePipeline(config.preprocessingModelPath, config.detectionModelPath);
    }

    loadTestData(): TestItem[] {
        const csvText = fs.readFileSync(this.config.testCsv, "utf8");
        const rows = parse(csvText, { columns: true, skip_empty_lines: true });

        const out: TestItem[] = [];
        for (const r of rows) {
            const file_path = r["file_path"];
            const cough_label = String(r["cough_label"] ?? "").toLowerCase();
            const label = cough_label === "true" ? 1 : 0;
            const audio_path = path.join(this.config.baseDir, file_path);
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

        const allProbs: number[] = [];
        const allLabels: number[] = [];
        const allSegProbs: number[] = [];
        const failedFiles: string[] = [];

        console.log("\nRunning Inference...");
        for (let i = 0; i < testData.length; i++) {
            const item = testData[i];
            try {
                const waveform = this.loader.loadAudio(item.audio_path);
                const { bagProb, segProbs } = await this.pipeline.predict(waveform);
                allProbs.push(bagProb);
                allLabels.push(item.label);
                allSegProbs.push(...segProbs);
            } catch (e: any) {
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

    private async createPlots(
        yTrue: number[],
        yProb: number[],
        segProb: number[],
        optimalThresh: number,
        auc: number,
        ap: number,
        outPath: string
    ) {
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
        fs.writeFileSync(outPath, image);
    }

    private calculateAndPrintMetrics(yTrue: number[], yProb: number[], segProb: number[], savePlots: boolean) {
        console.log("\nCalculating metrics...");

        const { fpr, tpr } = rocCurve(yTrue, yProb);
        const auc = aucFromCurve(fpr, tpr);
        const ap = averagePrecision(yTrue, yProb);

        const testLoss = logLoss(yTrue, yProb, 1e-7);

        // Threshold analysis (same thresholds list as python)
        const thresholds = [0.3, 0.4, 0.5, 0.6, 0.7];
        const thresholdResults: Record<string, any> = {};

        for (const thresh of thresholds) {
            const preds = yProb.map((p) => (p > thresh ? 1 : 0));
            const acc = accuracyScore(yTrue, preds);
            const f1 = f1Score(yTrue, preds);

            let tp = 0,
                fp = 0,
                fn = 0,
                tn = 0;
            for (let i = 0; i < yTrue.length; i++) {
                if (preds[i] === 1 && yTrue[i] === 1) tp++;
                else if (preds[i] === 1 && yTrue[i] === 0) fp++;
                else if (preds[i] === 0 && yTrue[i] === 1) fn++;
                else if (preds[i] === 0 && yTrue[i] === 0) tn++;
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
        const testThresholds: number[] = [];
        for (let i = 1; i <= 99; i++) testThresholds.push(i / 100);
        const f1s = testThresholds.map((t) => f1Score(yTrue, yProb.map((p) => (p > t ? 1 : 0))));
        let optimalIdx = 0;
        for (let i = 1; i < f1s.length; i++) if (f1s[i] > f1s[optimalIdx]) optimalIdx = i;

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
        console.log(
            [
                "              precision    recall  f1-score   support",
                `No Cough      ${report.rows[0].precision.toFixed(2)}       ${report.rows[0].recall.toFixed(2)}     ${report.rows[0].f1.toFixed(
                    2
                )}      ${report.rows[0].support}`,
                `Cough         ${report.rows[1].precision.toFixed(2)}       ${report.rows[1].recall.toFixed(2)}     ${report.rows[1].f1.toFixed(
                    2
                )}      ${report.rows[1].support}`,
                `macro avg     ${report.macro.precision.toFixed(2)}       ${report.macro.recall.toFixed(2)}     ${report.macro.f1.toFixed(
                    2
                )}      ${report.macro.support}`,
                `weighted avg  ${report.weighted.precision.toFixed(2)}       ${report.weighted.recall.toFixed(2)}     ${report.weighted.f1.toFixed(
                    2
                )}      ${report.weighted.support}`,
            ].join("\n")
        );

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
                std_probability:
                    segProb.length > 1
                        ? Math.sqrt(
                            segProb.reduce((s, x) => s + Math.pow(x - segProb.reduce((a, b) => a + b, 0) / segProb.length, 2), 0) /
                            segProb.length
                        )
                        : 0,
                min_probability: segProb.length ? Math.min(...segProb) : 0,
                max_probability: segProb.length ? Math.max(...segProb) : 0,
            },
        };

        const evalPath = path.join(this.config.outputDir, "app_pipeline_evaluation_results.json");
        fs.writeFileSync(evalPath, JSON.stringify(evalResults, null, 2));
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

        const testPath = path.join(this.config.outputDir, "app_pipeline_test_results.json");
        fs.writeFileSync(testPath, JSON.stringify(testResults, null, 2));
        console.log(`Compact results saved to: ${testPath}`);

        if (savePlots) {
            const plotPath = path.join(this.config.outputDir, "app_pipeline_plots.png");
            this.createPlots(yTrue, yProb, segProb, optimalThresh, auc, ap, plotPath)
                .then(() => console.log(`Plots saved to: ${plotPath}`))
                .catch((e) => console.log(`Plot creation failed (non-fatal): ${e?.message ?? String(e)}`));
        }
    }
}

/** -------------------- Main -------------------- */

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option("limit", { type: "number", describe: "Limit number of files for quick testing" })
        .option("no-plots", { type: "boolean", default: false, describe: "Disable plot saving" })
        .help()
        .parse();

    const config = new Config();
    const evaluator = new AppPipelineEvaluator(config);

    // Monkey-patch limit like python
    if (argv.limit) {
        const original = evaluator.loadTestData.bind(evaluator);
        evaluator.loadTestData = () => original().slice(0, argv.limit as number);
        console.log(`Limiting to first ${argv.limit} samples...`);
    }

    await evaluator.evaluate(!argv["no-plots"]);
}

main().catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
});

