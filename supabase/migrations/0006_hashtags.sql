-- Hashtag-förslag: Claude föreslår 3-5 relevanta hashtags per klipp (generate-plan.ts),
-- sparas här så de finns kvar tillsammans med resten av klippet.

alter table clips add column if not exists hashtags text[];
