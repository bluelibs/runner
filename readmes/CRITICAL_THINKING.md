Before Starting Work:

- "Think critically about whether this change is actually needed"
- "Question the assumptions behind this approach"
- "What's the real problem we're solving? Is this the best solution?"
- "Apply second-order thinking - what could go wrong with this approach?"
- "Is this over-engineering? What's the simplest thing that could work?"

During Design/Planning:

- "What are the trade-offs of this approach? Be specific."
- "How could this make the code worse, not better?"
- "Where are we introducing unnecessary complexity?"
- "Does this follow the KISS principle? If not, why?"
- "What would a future developer think of this code?"
- "Are we optimizing prematurely? What's the actual evidence this is needed?"

For DRY/Similar Patterns:

- "Is this repetition actually harmful, or does it serve clarity?"
- "Does consolidating this code make it more complex than the repetition?"
- "Are we sacrificing type safety or readability for DRY?"
- "Is this a case where WET (Write Everything Twice) is better than DRY?"

For Testing:

- "Are these tests actually valuable or just chasing coverage?"
- "What edge cases are we missing?"
- "How could this test give false confidence?"
- "Are we testing implementation details or behavior?"

After Implementation:

- "Review this critically - what would you improve?"
- "What's the weakest part of this solution?"
- "If you were taking over this code, what would you question?"
- "Does this solve the original problem or create new ones?"

General Meta-Prompts:

- "You're overlooking something obvious. What is it?"
- "Challenge your own answer - what's wrong with it?"
- "Play devil's advocate against your own approach"
- "What's the counter-argument to doing this?"
- "Slow down and think - is this really necessary?"
