(function () {
    const NS = 'http://www.w3.org/2000/svg';

    function ensureSvgDefs(root) {
        if (!root) return null;
        const existing = root.querySelector('#elders-menu-title-fx');
        if (existing) return existing;

        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('id', 'elders-menu-title-fx');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.position = 'absolute';
        svg.style.width = '0';
        svg.style.height = '0';
        svg.style.overflow = 'hidden';

        const defs = document.createElementNS(NS, 'defs');

        const filter = document.createElementNS(NS, 'filter');
        filter.setAttribute('id', 'eldersMetalMelt');
        filter.setAttribute('x', '-20%');
        filter.setAttribute('y', '-20%');
        filter.setAttribute('width', '140%');
        filter.setAttribute('height', '140%');
        filter.setAttribute('filterUnits', 'objectBoundingBox');

        const turbulence = document.createElementNS(NS, 'feTurbulence');
        turbulence.setAttribute('type', 'fractalNoise');
        turbulence.setAttribute('baseFrequency', '0.012 0.14');
        turbulence.setAttribute('numOctaves', '2');
        turbulence.setAttribute('seed', '2');
        turbulence.setAttribute('result', 'noise');

        const displacement = document.createElementNS(NS, 'feDisplacementMap');
        displacement.setAttribute('in', 'SourceGraphic');
        displacement.setAttribute('in2', 'noise');
        displacement.setAttribute('scale', '12');
        displacement.setAttribute('xChannelSelector', 'R');
        displacement.setAttribute('yChannelSelector', 'G');
        displacement.setAttribute('result', 'displaced');

        const shadow = document.createElementNS(NS, 'feDropShadow');
        shadow.setAttribute('dx', '0');
        shadow.setAttribute('dy', '6');
        shadow.setAttribute('stdDeviation', '7');
        shadow.setAttribute('flood-color', '#000');
        shadow.setAttribute('flood-opacity', '0.55');

        filter.appendChild(turbulence);
        filter.appendChild(displacement);
        filter.appendChild(shadow);

        defs.appendChild(filter);
        svg.appendChild(defs);
        root.appendChild(svg);

        return svg;
    }

    function attach(container) {
        try {
            const root = container || document;
            const title = root.querySelector('.game-title');
            const subtitle = root.querySelector('.game-subtitle');
            if (!title || !subtitle) return;

            ensureSvgDefs(root);

            title.classList.add('metal-title');
            subtitle.classList.add('metal-subtitle');

            // Avoid double-starting RAF loops.
            if (root.__eldersMenuTitleFxRunning) return;
            root.__eldersMenuTitleFxRunning = true;

            const turbulence = root.querySelector('#eldersMetalMelt feTurbulence');
            const displacement = root.querySelector('#eldersMetalMelt feDisplacementMap');
            if (!turbulence || !displacement) return;

            const start = performance.now();
            const durMs = 7000; // perfectly looping

            const tick = (now) => {
                if (!root.__eldersMenuTitleFxRunning) return;

                const t = ((now - start) % durMs) / durMs;
                const a = t * Math.PI * 2;

                // Small, smooth wobble: looks like heated metal "melting".
                const fx = 0.010 + 0.0035 * (0.5 + 0.5 * Math.sin(a));
                const fy = 0.135 + 0.03 * (0.5 + 0.5 * Math.sin(a + Math.PI / 2));
                const scale = 10 + 6 * (0.5 + 0.5 * Math.sin(a + Math.PI / 3));

                turbulence.setAttribute('baseFrequency', `${fx.toFixed(4)} ${fy.toFixed(4)}`);
                displacement.setAttribute('scale', `${scale.toFixed(2)}`);

                // Drive CSS shimmer + hue shift in perfect loop.
                root.documentElement?.style?.setProperty('--eldersTitlePhase', String(t));

                requestAnimationFrame(tick);
            };

            requestAnimationFrame(tick);
        } catch (e) {
            // no-op
        }
    }

    function detach(container) {
        try {
            const root = container || document;
            root.__eldersMenuTitleFxRunning = false;
        } catch (e) {}
    }

    window.MenuTitleFx = {
        attach,
        detach
    };
})();
