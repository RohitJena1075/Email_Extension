import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from summary_classification import process_email
from fastapi.responses import JSONResponse
import traceback

app = FastAPI(title="Email Classifier + Summarizer API")

# CORS settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=["chrome-extension://*", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Req(BaseModel):
    text: str

@app.post("/classify_summarize")
async def classify_summarize(req: Req):
    try:
        print("[DEBUG] classify_summarize called with text length:", len(req.text))
        result = process_email(req.text)
        print("[DEBUG] process_email result:", result)
        return JSONResponse(content=result)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.get("/health")
def health():
    return {"ok": True}

# ==========================
# Main Entry
# ==========================
if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)
