'use strict';

const forecastFrame = document.getElementById('forecast-frame');
const reloadForecast = () => { forecastFrame.src = forecastFrame.src; };
document.getElementById('forecast-refresh').addEventListener('click', () => {
  reloadForecast();
  document.getElementById('forecast-status').textContent = 'Forecast reloaded. Decision Desk HQ owns these projections and their update times; this is a model forecast, not vote counts or race calls.';
});
setInterval(() => {
  if (document.visibilityState === 'visible') reloadForecast();
}, 300000);
