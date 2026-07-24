import { pipeline } from '@huggingface/transformers';
import {
  TOPICS, TOPIC_CONFIDENCE_FLOOR, UNCATEGORISED_TOPIC,
  SENTIMENT_CONFIDENCE_FLOOR
} from './taxonomy.js';

// Both pipelines are loaded once and reused for every message in the run — @xenova/transformers
// caches the downloaded ONNX model files on disk after the first run, so subsequent runs (and this
// process's own remaining lifetime) don't re-download anything.
let sentimentPipelinePromise = null;
export function getSentimentPipeline(){
  if (!sentimentPipelinePromise) {
    sentimentPipelinePromise = pipeline('sentiment-analysis', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
  }
  return sentimentPipelinePromise;
}

let topicPipelinePromise = null;
export function getTopicPipeline(){
  if (!topicPipelinePromise) {
    topicPipelinePromise = pipeline('zero-shot-classification', 'Xenova/distilbert-base-uncased-mnli');
  }
  return topicPipelinePromise;
}

/* Classifies one message's text into {sentiment, topic} — the ONLY two values this worker ever
   derives from real message content. Neither pipeline's raw output (scores, embeddings, the
   original text) is ever returned, logged, or persisted — ClassifyMessage's return value is the
   sole boundary between "real chat text" and everything downstream of it. */
export async function classifyMessage(text){
  const sentimentPipe = await getSentimentPipeline();
  const topicPipe = await getTopicPipeline();

  const [sentimentResult] = await sentimentPipe(text);
  const sentiment = sentimentResult.score >= SENTIMENT_CONFIDENCE_FLOOR
    ? (sentimentResult.label === 'POSITIVE' ? 'positive' : 'negative')
    : 'neutral';

  const topicResult = await topicPipe(text, TOPICS);
  const topic = topicResult.scores[0] >= TOPIC_CONFIDENCE_FLOOR
    ? topicResult.labels[0]
    : UNCATEGORISED_TOPIC;

  return { sentiment, topic };
}
