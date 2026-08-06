import os
import certifi
from dotenv import load_dotenv

load_dotenv()

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

from typing import TypedDict, Annotated
import operator
import uuid

from pydantic import SecretStr

import psycopg
from psycopg import Connection
from psycopg.rows import dict_row, DictRow

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.postgres import PostgresSaver
from langchain_core.messages import (
    AnyMessage,
    HumanMessage,
    AIMessage,
    SystemMessage
)
from langchain_groq import ChatGroq
from langchain_core.runnables import RunnableConfig

from tools.search_tool import duckduckgo_search
from tools.flight_tool import search_flights

def get_database_url():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL environment variable is not set. Set it to your PostgreSQL connection string.")
    
    if "sslmode" not in db_url:
        separator = '&' if '?' in db_url else '?'
        db_url = f"{db_url}{separator}sslmode=require"

    return db_url

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY environment variable is not set. Set it to your Groq API key.")

# //
# LLM
# //

llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    api_key=SecretStr(GROQ_API_KEY)
)

#//
# State
# //

class TravelState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    user_query: str
    flight_results: str
    hotel_results: str
    itinerary: str
    llm_calls: int

# =============
#  Flight agent
# =============
def flight_agent(state: TravelState): # -> TravelState:
    # extract the user query from the state
    query = state.get("user_query", "")
    # call the flight search tool with the user query
    flight_data = search_flights(query)
    # update the state with the flight results
    return {
        "flight_results": flight_data,
        "messages": [
            AIMessage(content=f"Flight search fetched successfully.")
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }
# =============
#  Hotel agent
# =============
def hotel_agent(state: TravelState):
    query = f"Best hotels for {state.get("user_query", "")}"
    hotel_data = duckduckgo_search(query)

    return {
        "hotel_results": hotel_data,
        "messages": [
            AIMessage(content="Hotel search fetched successfully.")
        ],
        "llm_calls": state.get("llm_calls", 0) + 1
    }
# =============
#  Itinerary agent
# =============
def itinerary_agent(state: TravelState):
    # Ask the LLM to combine flight and hotel results into an itinerary
    prompt = f"""
    You are a travel assistant. Create a complete travel itinerary.
    User Query: {state.get("user_query", "<missing>")}
    Flight Results: {state.get("flight_results", "<missing>")}
    Hotel Results: {state.get("hotel_results", "<missing>")}
    Make the itinerary practical, budge-aware, and easy to follow. 
    """
    response = llm.invoke([
        SystemMessage(content="You are an expert travel planner."),
        HumanMessage(content=prompt)
    ])

    itinerary = response.content if response else "No itinerary generated."

    return {
        "itinerary": itinerary,
        "messages": [response] if response else [],
        "llm_calls": state.get("llm_calls", 0) + 1
    }
# =====================
# Final response agent
# =====================

def final_response_agent(state: TravelState):
    final_prompt = f"""
    General the final travel response for the user.
    User Request: {state.get("user_query", "<missing>")}
    Flights: {state.get("flight_results", "<missing>")}
    Hotels: {state.get("hotel_results", "<missing>")}
    Itinerary: {state.get("itinerary", "<missing>")}

    Format the final answer beautifully using these sections:
    1. Summary of the trip
    2. Flight details or information
    3. Hotel suggestions
    4. Day-by-Day Itinerary
    5. Estimated Budget
    6. Final Recommendations

    Important:
    - Be clear and practical.
    - Mention that live flight API may not provide ticket prices if pricing is not available.
    - Keep the response useful for real travel planning.
    """
    response = llm.invoke([
        SystemMessage(content="You are a professional AI travel booking assistant."),
        HumanMessage(content=final_prompt)
    ])

    return {
        "messages": [response] if response else [],
        "llm_calls": state.get("llm_calls", 0) + 1
    }

# =================
# Building Graph
# =================

graph = StateGraph(TravelState)

# create nodes for each agent
graph.add_node(node="flight_agent", action=flight_agent)
graph.add_node(node="hotel_agent", action=hotel_agent)
graph.add_node(node="itinerary_agent", action=itinerary_agent)
graph.add_node(node="final_response_agent", action=final_response_agent)
# or simply -> graph.add_node(node="<node_name>", action=<function_name>)

# create edges to define the flow of the graph
graph.add_edge(start_key=START, end_key="flight_agent")
graph.add_edge(start_key="flight_agent", end_key="hotel_agent")
graph.add_edge(start_key="hotel_agent", end_key="itinerary_agent")
graph.add_edge(start_key="itinerary_agent", end_key="final_response_agent")
graph.add_edge(start_key="final_response_agent", end_key=END)
# or simply -> graph.add_edge("<start_node>", "<end_node>")

# ========================
# Postgres Saver for Checkpointing
# ========================

DATABASE_URL = get_database_url()

_conn:Connection[DictRow] = psycopg.connect(
         DATABASE_URL, # this is the connection string for your PostgreSQL database
         autocommit=True, # this ensures that changes in the database are saved automatically without needing to call commit()
         row_factory=dict_row # this makes sure that the results we get from the database are in dictionary format, which is easier to work with
)

checkpoint_saver = PostgresSaver(conn=_conn)
checkpoint_saver.setup() # This sets up the necessary tables in the database for saving checkpoints. If the tables already exist, this will not overwrite them.

travel_graph = graph.compile(checkpointer=checkpoint_saver) # This compiles the graph and sets up the checkpointing mechanism using the PostgresSaver we just created.

# ========================
# Function to run the travel planning graph
# which is used by the API (FastAPI) endpoint to process user requests

def run_travel_planner(user_input: str, thread_id: str|None=None):
    # If no thread_id is provided, generate a new one
    if not thread_id:
        thread_id = f"user_{uuid.uuid4().hex}"

    config = {
        "configurable": {
            "thread_id": thread_id,
        }
    }

    result = travel_graph.invoke(
        {
            "messages": [
            HumanMessage(content=user_input)
        ],
        "user_query": user_input,
        "flight_results": "",
        "hotel_results": "",
        "itinerary": "",
        "llm_calls": 0
        },
        config=RunnableConfig(**config)
    )

    final_answer = result["messages"][-1].content if result["messages"] else "No response generated."

    return {
        "thread_id": thread_id,
        "answer": final_answer,
        "flight_results": result.get("flight_results", ""),
        "hotel_results": result.get("hotel_results", ""),
        "itinerary": result.get("itinerary", ""),
        "llm_calls": result.get("llm_calls", 0)
    }