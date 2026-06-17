from sqlalchemy import Column, Integer, String, Float, ForeignKey
from sqlalchemy.types import JSON
from database import Base

class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    username      = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(200), nullable=False)


class GameState(Base):
    __tablename__ = "game_states"

    id       = Column(Integer, primary_key=True, index=True)
    user_id  = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    budget   = Column(Float,   nullable=False, default=10000.0)
    holdings = Column(JSON,    nullable=False, default=dict)   # { "AAPL": 5 }
    avg_cost = Column(JSON,    nullable=False, default=dict)   # { "AAPL": 182.5 }
