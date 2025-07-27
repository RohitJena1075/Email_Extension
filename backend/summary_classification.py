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
# Email Classification Function
# ============================
def classify_email(text):
    tokens = cat_tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        padding="max_length",
        max_length=512
    )

    # Move only tensors to device safely
    encoding = {k: v.to(device_type) for k, v in tokens.items() if isinstance(v, torch.Tensor)}

    # Sanity check for token range
    max_id = encoding["input_ids"].max().item()
    vocab_size = cat_model.config.vocab_size
    if max_id >= vocab_size:
        raise ValueError(f"Token ID {max_id} exceeds vocab size {vocab_size}")

    with torch.no_grad():
        output = cat_model(**encoding)

    probs = torch.sigmoid(output.logits)
    predicted = (probs > 0.5).squeeze().int().tolist()
    categories = [label_classes[i] for i, val in enumerate(predicted) if val == 1]
    return categories

# ============================
# Dynamic Summarizer Function
# ============================
def summarize_email(text):
    prompt = (
        "Summarize this email focusing on purpose, key agenda, dates, and action items:\n\n"
        + text.strip()
    )

    # Tokenize without sending to device directly
    tokenized = bart_tokenizer(prompt, return_tensors="pt")
    input_len = tokenized["input_ids"].shape[1]
    tokenized = {k: v.to(device_type) for k, v in tokenized.items() if isinstance(v, torch.Tensor)}

    # Dynamic max length
    max_length = max(40, min(200, int(input_len * 0.7)))

    result = summarizer(
        prompt,
        max_length=max_length,
        do_sample=False
    )
    return result[0]["summary_text"]

# ============================
# Unified Function
# ============================
def process_email(text):
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
