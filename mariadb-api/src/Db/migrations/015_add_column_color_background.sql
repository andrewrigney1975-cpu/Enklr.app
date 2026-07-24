-- Ported from api/Enkl.Api's AddColumnColorBackground migration (php-api's 034_add_column_color_background.sql).
-- Whether Color also tints the column's background (the pre-existing full look); when false, Color
-- still colors the top border but the background stays the plain default grey. Defaults true so
-- every pre-existing colored column keeps its current appearance.
ALTER TABLE "Columns" ADD COLUMN "ColorBackground" BOOLEAN NOT NULL DEFAULT true;
