// Plays the notch demo on a loop. Same states as the real app:
// closed -> listening -> thinking -> speaking -> closed.
(function () {
  var island = document.getElementById('island');
  var line = document.getElementById('line');
  var said = document.getElementById('said');
  var steps = document.getElementById('steps');
  var reply = document.getElementById('reply');
  var caption = document.getElementById('caption');
  var clock = document.getElementById('clock');

  var scenes = [
    {
      ask: 'how much battery do I have left?',
      steps: ['Check battery status'],
      answer: '49 percent, about two hours forty. Plug in before the meeting.'
    },
    {
      ask: 'play something chill on Spotify and turn it down a bit',
      steps: ['Open Spotify', 'Play "Lo-fi Beats"', 'Set volume to 30%'],
      answer: 'Lo-fi is on, volume at thirty. Try not to fall asleep.'
    },
    {
      ask: 'put a meeting with Raven on my calendar tomorrow at nine',
      steps: ['Read Calendar events', 'Create "Meeting with Raven" at 09:00'],
      answer: 'Yarın saat dokuza Raven ile toplantıyı ekledim.'
    },
    {
      ask: 'what\'s eating my RAM?',
      steps: ['List processes by memory', 'Chrome: 41 tabs, 6.2 GB'],
      answer: 'Chrome, with forty one tabs. I\'m not judging. Okay, a little.'
    }
  ];

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var timers = [];
  function later(ms, fn) { timers.push(setTimeout(fn, ms)); }

  function set(state, opts) {
    opts = opts || {};
    island.dataset.state = state;
    line.textContent = opts.line || '';
    said.textContent = opts.said || '';
    reply.textContent = opts.reply || '';
    steps.innerHTML = '';
    (opts.steps || []).forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s;
      steps.appendChild(li);
    });
  }

  function tick() {
    var d = new Date();
    clock.textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  tick();
  setInterval(tick, 30000);

  if (reduced) {
    var s = scenes[0];
    set('speaking', { said: s.ask, steps: s.steps, reply: s.answer });
    caption.textContent = '"Jager, ' + s.ask + '"';
    return;
  }

  function play(i) {
    var s = scenes[i % scenes.length];
    var t = 0;
    set('closed');
    caption.innerHTML = '&nbsp;';

    t += 1600;
    later(t, function () {
      set('listening', { line: 'Listening…' });
      caption.textContent = 'you: "Jager, ' + s.ask + '"';
    });

    t += 2400;
    s.steps.forEach(function (step, n) {
      later(t + n * 1100, function () {
        set('thinking', { line: step, said: s.ask, steps: s.steps.slice(0, n) });
      });
    });
    t += s.steps.length * 1100 + 500;

    later(t, function () {
      set('speaking', { said: s.ask, steps: s.steps, reply: s.answer });
      caption.textContent = 'jager, out loud: "' + s.answer + '"';
    });

    t += 3800;
    later(t, function () {
      set('closed');
      caption.textContent = 'you: "Appreciated, Jager." It goes back into the notch.';
    });

    t += 2600;
    later(t, function () { play(i + 1); });
  }

  play(0);
})();
