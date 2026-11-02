# Integer line pricing

A half-point line has no push. The existing two-way no-vig median is the market chance for over or under.

A whole-number line can land exactly on the number. PrizePicks payout rules for that tie were inspected on 2026-10-09 and are not verified for standard, flex, demon, or goblin entries. This engine does not claim entry expected value.

For an integer N, the preferred price uses the half-point brackets on either side:

- P(result <= N-1) = no-vig under at N-0.5
- P(result <= N) = no-vig under at N+0.5
- P(result = N) = the difference
- P(result >= N+1) = no-vig over at N+0.5

Those three probabilities sum to 1 when the brackets are valid. A negative gap is rejected as inconsistent. It is not clipped to zero.

A two-way sportsbook price posted at N itself is the chance of each side conditional on the result not landing on N. That is labeled `INTEGER_PUSH_PROBABILITY_UNKNOWN`. It is not used as an unconditional hit chance.

No statistical count model is used. If the adjacent lines are missing, the report says the push probability cannot be estimated.

Alternate market keys are requested only for integer props, and only when The Odds API documents an alternate for that sport and market.
