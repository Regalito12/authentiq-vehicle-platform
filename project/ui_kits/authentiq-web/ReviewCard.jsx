function ReviewCard({ review }) {
  return (
    <div className="review-card">
      <div className="review-stars">{"★".repeat(review.stars)}</div>
      <div className="review-text">"{review.text}"</div>
      <div className="review-vehicle">{review.vehicle}</div>
      <div className="review-author">
        <div className="review-avatar">
          <img src={review.avatar} alt="" />
        </div>
        <div>
          <div className="name">{review.author}</div>
          <div className="role">{review.role}</div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ReviewCard });
