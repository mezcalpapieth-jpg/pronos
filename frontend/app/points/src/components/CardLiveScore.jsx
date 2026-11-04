import React from 'react';

export default function CardLiveScore({ score }) {
  const label = `${score.left.name} ${score.left.score} – ${score.right.score} ${score.right.name}${score.status ? ` · ${score.status}` : ''}`;
  return (
    <span className="points-card-live-score" data-completed={score.completed} title={label} role="img" aria-label={label}>
      <span className="points-card-live-score-teams" aria-hidden="true">
        <span>{score.left.abbreviation}</span>
        <strong>{score.left.score}–{score.right.score}</strong>
        <span>{score.right.abbreviation}</span>
      </span>
      {score.status && <span className="points-card-live-score-clock" aria-hidden="true">{score.status}</span>}
    </span>
  );
}
