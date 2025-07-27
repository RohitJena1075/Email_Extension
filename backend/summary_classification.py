import torch
import json
import warnings
from transformers import (
    BertTokenizerFast,
    BertForSequenceClassification,
    BartForConditionalGeneration,
    BartTokenizer,
    pipeline,
    AutoTokenizer
)
import os
from typing import List

# ============================
# Setup: Environment + Warnings
# ============================
warnings.filterwarnings("ignore")
os.environ["CUDA_LAUNCH_BLOCKING"] = "1"  # For synchronous CUDA debugging

# ============================
# Device Setup
# ============================
device_id = 0 if torch.cuda.is_available() else -1
device_type = "cuda" if device_id != -1 else "cpu"
USE_CPU_ONLY = False  # Will switch to CPU if GPU crashes

# ============================
# Load Classification Model (BERT)
# ============================
cat_model_path = "ro08hi11t23/email-classifier-bert"
cat_tokenizer = AutoTokenizer.from_pretrained(cat_model_path)
cat_model = BertForSequenceClassification.from_pretrained(cat_model_path).to(device_type)
cat_model.eval()

# ============================
# Load Label Classes
# ============================
with open("Email_File/label_classes.json", "r") as f:
    label_classes = json.load(f)

# ============================
# Load Summarization Model (BART)
# ============================
bart_name = "facebook/bart-large-cnn"
bart_tokenizer = BartTokenizer.from_pretrained(bart_name)
bart_model = BartForConditionalGeneration.from_pretrained(bart_name).to(device_type)

summarizer = pipeline(
    "summarization",
    model=bart_model,
    tokenizer=bart_tokenizer,
    device=device_id
)

# ============================
# Helper
# ============================
def _device_type():
    return "cpu" if USE_CPU_ONLY else device_type

def _log_err(msg: str):
    print(msg, flush=True)

# ============================
# Email Classification Function
# ============================
def classify_email(text: str) -> List[str]:
    try:
        tokens = cat_tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            padding="max_length",
            max_length=512
        )

        encoding = {k: v.to(_device_type()) for k, v in tokens.items() if isinstance(v, torch.Tensor)}

        vocab_size = cat_model.config.vocab_size
        if encoding["input_ids"].max().item() >= vocab_size:
            raise ValueError(f"Token ID exceeds vocab size {vocab_size}")

        with torch.no_grad():
            output = cat_model(**encoding)

        probs = torch.sigmoid(output.logits)
        predicted = (probs > 0.5).squeeze().int().tolist()
        categories = [label_classes[i] for i, val in enumerate(predicted) if val == 1]
        return categories
    except RuntimeError as re:
        if "CUDA" in str(re).upper() and device_type == "cuda":
            _log_err("[WARN] CUDA error in classify_email. Switching to CPU.")
            global USE_CPU_ONLY
            USE_CPU_ONLY = True
            return classify_email(text)
        raise

# ============================
# Dynamic Summarizer Function
# ============================
def summarize_email(text: str) -> str:
    """
    Dynamically adjusts summarization max_length and min_length based on input size.
    Falls back to CPU if CUDA errors occur.
    """
    global USE_CPU_ONLY, summarizer, bart_model

    words = text.strip().split()
    total_words = len(words)

    # Determine chunk size dynamically (max 400 words per chunk)
    chunk_size = min(400, max(100, total_words // 3))
    chunks, cur, cur_len = [], [], 0
    for w in words:
        if cur_len + 1 > chunk_size:
            chunks.append(" ".join(cur))
            cur, cur_len = [w], 1
        else:
            cur.append(w)
            cur_len += 1
    if cur:
        chunks.append(" ".join(cur))

    if not chunks:
        return ""

    def _dynamic_summary(chunk: str, on_cpu: bool = False) -> str:
        global summarizer, bart_model
        word_count = len(chunk.split())
        # Dynamic max/min length based on input words
        max_len = max(60, min(300, int(word_count * 0.5)))
        min_len = max(20, int(max_len * 0.3))

        summarizer_local = (
            pipeline("summarization", model=bart_model.to("cpu"), tokenizer=bart_tokenizer, device=-1)
            if on_cpu else summarizer
        )

        result = summarizer_local(
            chunk,
            max_length=max_len,
            min_length=min_len,
            do_sample=False
        )
        return result[0]["summary_text"]

    try:
        summaries = [_dynamic_summary(chunk, on_cpu=USE_CPU_ONLY) for chunk in chunks]
        return " ".join(summaries)

    except RuntimeError as re:
        if "CUDA" in str(re).upper() and _device_type() == "cuda":
            print("[WARN] CUDA error in summarization. Switching to CPU permanently.")
            USE_CPU_ONLY = True
            summaries = [_dynamic_summary(chunk, on_cpu=True) for chunk in chunks]
            return " ".join(summaries)
        raise


# ============================
# Unified Function
# ============================
def process_email(text: str):
    return {
        "categories": classify_email(text),
        "summary": summarize_email(text)
    }

# ============================
# Test Example
# ============================
if __name__ == "__main__":
    sample_email = """
    Dear Rohit,
    We are thrilled to invite you to the upcoming AI Conference, scheduled for August 20th, 2025.
    This exciting gathering will bring together leading minds in artificial intelligence,
    offering a full day of insightful keynote sessions, engaging workshops, and valuable networking opportunities.
    Please confirm your participation.
    Warm regards,
    Organizing Committee
    """
    result = process_email(sample_email)
    print("🔎 Predicted Categories:", result["categories"])
    print("📝 Summary:", result["summary"])
