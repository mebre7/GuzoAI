from pathlib import Path
import logging
import os
import secrets
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette import status

from backend import run_travel_planner

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="GuzoAI: AI Travel Planning System",
    description="LangGraph Multi-Agent Travel Planner with FastAPI Frontend",
    version="1.0.0"
)

# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="static"
)

templates = Jinja2Templates(
    directory=str(BASE_DIR / "templates")
)


class TravelRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={}
    )


@app.post("/api/travel")
async def travel_planner(request_data: TravelRequest, request: Request):
    try:
        user_message = request_data.message.strip()

        if not user_message:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "success": False,
                    "error": "Message can't be empty."
                }
            )

        session_id = request.cookies.get("guzo_session") or secrets.token_urlsafe(32)
        result = await run_in_threadpool(
            run_travel_planner, user_message, f"session_{session_id}"
        )

        hotel_results = result.get("hotel_results", "")
        if isinstance(hotel_results, list):
            hotel_results = [
                item if isinstance(item, str) else str(item)
                for item in hotel_results
            ]

        response = JSONResponse(
            content={
                "success": True,
                "thread_id": result["thread_id"],
                "answer": result["answer"],
                "flight_results": result.get("flight_results", ""),
                "hotel_results": hotel_results,
                "itinerary": result.get("itinerary", ""),
                "llm_calls": result.get("llm_calls", 0),
            }
        )
        response.set_cookie(
            "guzo_session",
            session_id,
            httponly=True,
            samesite="lax",
            secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
            max_age=60 * 60 * 24 * 30,
        )
        return response
    except Exception as e:
        logger.exception("Travel planning request failed")

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "error": "Travel planning is temporarily unavailable. Please try again later."
            }
        )


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "message": "AI travel Planner API is running"
    }


@app.get("/favicon.ico")
async def favicon():
    return JSONResponse(content={})


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )
