# The Hager Movie Library

379 films. Two rating columns. A queue of what we have not seen yet, and a note
on each film about what we actually thought.

**The app:** https://hagerca.github.io/movie-library/

## How it works

`movie-library.csv` is the one source of truth. Everything else is generated.

```
node build.mjs                      # regenerate index.html, movie-library.md, library.json
node enrich.mjs                     # fill posters, runtimes, Costa Rica streaming from TMDB
node enrich.mjs --streaming         # refresh just the streaming column
node enrich.mjs --file=suggestions.csv
node upcoming.mjs                   # rebuild the Coming Soon tracker
```

`enrich.mjs` needs a TMDB read token in a `.env` file. That file is not in this repo
and never will be.

## The scale

> If something's a 3.5 it means that we enjoyed it but wouldn't necessarily watch
> it again. Four and above we'll love so much that we go back to watch them time
> and time again.

4.0 is the rewatch threshold. A 3.5 is a film we enjoyed once.

## Editing it

| To change | Edit |
|---|---|
| Films, ratings, comments, the queue | `movie-library.csv` |
| How it looks | `app.css`. A source file, never overwritten by the build. |
| Features, tabs, filters, the editor | `app.js`. Also a source file. |
| What data reaches the page | `build.mjs` |

Never edit `index.html`. It is a generated shell and the next build overwrites it.

Edits made inside the app are held in your browser and handed back to SAGE as text
via the **Review** button. A page served as static files cannot write to the library
by itself, so Review is the save button.

## Notes

Posters are from [TMDB](https://www.themoviedb.org/) and are stored locally so the
page has no third-party requests at all. This product uses the TMDB API but is not
endorsed or certified by TMDB.

Streaming availability is checked for **Costa Rica**. A film with no checked date
carries no claim.
