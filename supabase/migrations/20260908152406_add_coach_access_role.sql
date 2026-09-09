-- 'coach' is deliberately NOT added to can_view_athlete()'s blanket check below —
-- that function currently gates athletes/athlete_sports/games/measurements/media all
-- at once via "any live athlete_access row, any role". A coach's legitimate need is
-- narrower (stats and measurements, never games/journey/photos), so it gets its own
-- narrower function and its own policies on only the tables it should reach.
alter type access_role add value if not exists 'coach';
;
