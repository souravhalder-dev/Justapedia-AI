from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.models import Feedback, Message
from app.dependencies import get_db
from app.schemas.conversations import FeedbackCreate, FeedbackRead


router = APIRouter()


@router.post("", response_model=FeedbackRead, status_code=status.HTTP_201_CREATED)
def create_feedback(payload: FeedbackCreate, db: Session = Depends(get_db)) -> Feedback:
    message = db.get(Message, payload.message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")

    feedback = Feedback(
        message_id=payload.message_id,
        rating=payload.rating,
        reason=payload.reason,
        comment=payload.comment,
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return feedback
