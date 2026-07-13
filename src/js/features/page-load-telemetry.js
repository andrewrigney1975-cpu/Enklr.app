"use strict";
import { reportPageLoadTimingApi } from '../api.js';

/* Real User Monitoring for the "APM - Web App Responsiveness" chart on the Vendor Portal Dashboard
   (a separate, standalone app sharing this app's Postgres DB — see vendor-portal's own
   web/js/features/webapp-latency-monitor.js for the reader side). Reports how long THIS real page
   load actually took, from request to "ready to interact with" — defined as the moment init() (see
   app.js) finishes running, its very last step.

   performance.now() at that point is already elapsed ms since navigation start (performance.now() is
   relative to performance.timeOrigin, which for the top-level document IS navigation start) — no
   Navigation Timing API entries needed, just reading a number that already exists.

   Fire-and-forget: a telemetry failure (endpoint unreachable, this app running standalone with no
   API at all, etc.) must never surface to the user or affect anything else the app does. */
export function reportPageLoadTiming(){
  var readyMs = performance.now();
  reportPageLoadTimingApi(readyMs).catch(function(){});
}
