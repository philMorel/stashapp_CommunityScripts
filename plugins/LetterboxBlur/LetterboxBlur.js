// StashApp plugin for Letterbox Blur

(async () => {
    'use strict';

    let animationFrameId = null;
    let blurCanvas = null;
    let videoElement = null; // Store video element reference
    let playerInstance = null; // Store player instance reference
    let useWebGL = false;
    let gl = null;
    let program = null;
    let texture = null;
    let positionBuffer = null;
    let tempCanvas = null; // Temporary canvas for downsampling video frame
    let tempCanvasContext = null; // Context for temporary canvas
    let intermediateTexture = null; // Texture for the first blur pass
    let framebuffer = null; // Framebuffer to render to intermediateTexture
    let frameSkipCounter = 0; // Counter for frame skipping
    let isBlurEnabled = true; // Toggle state for blur effect
    let toggleButton = null; // Store toggle button reference
    
    let pluginSettings = {}; // Store plugin settings
    const defaultPluginSettings = { // Define default settings
        blurStrength: 15 // Default blur strength
    };

    // WebGL vertex shader (used for both passes)
    const vertexShaderSource = `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        varying vec2 v_texCoord;
        
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord; // Revert vertical flip in shader
        }
    `;

    // WebGL fragment shader - Horizontal blur pass
    const fragmentShaderHorizontalSource = `
        precision mediump float;
        uniform sampler2D u_texture;
        uniform vec2 u_resolution;
        uniform float u_blurRadius; // Variable blur radius uniform
        varying vec2 v_texCoord;
        
        void main() {
            vec2 texelSize = 1.0 / u_resolution;
            vec4 color = vec4(0.0);
            float total = 0.0;
            
            // Horizontal blur samples
            float radius = u_blurRadius;
            for (float x = -25.0; x <= 25.0; x += 1.0) { // Fixed loop bounds
                 float weight = 1.0; // Simple box blur weight
                 if (abs(x) <= radius) {
                    color += texture2D(u_texture, v_texCoord + vec2(x * texelSize.x, 0.0)) * weight;
                    total += weight;
                 }
            }
            
            if (total > 0.0) {
                gl_FragColor = color / total;
            } else {
                gl_FragColor = texture2D(u_texture, v_texCoord);
            }
        }
    `;

    // WebGL fragment shader - Vertical blur pass
    const fragmentShaderVerticalSource = `
        precision mediump float;
        uniform sampler2D u_texture;
        uniform vec2 u_resolution;
        uniform float u_blurRadius; // Variable blur radius uniform
        varying vec2 v_texCoord;
        
        void main() {
            vec2 texelSize = 1.0 / u_resolution;
            vec4 color = vec4(0.0);
            float total = 0.0;
            
            // Vertical blur samples
            float radius = u_blurRadius;
             for (float y = -25.0; y <= 25.0; y += 1.0) { // Fixed loop bounds
                 float weight = 1.0; // Simple box blur weight
                 if (abs(y) <= radius) {
                    color += texture2D(u_texture, v_texCoord + vec2(0.0, y * texelSize.y)) * weight;
                    total += weight;
                 }
            }
            
            if (total > 0.0) {
                gl_FragColor = color / total;
            } else {
                gl_FragColor = texture2D(u_texture, v_texCoord);
            }
        }
    `;

    // Initialize WebGL context and shaders
    const initWebGL = (canvas) => {
        try {
            console.log('Initializing WebGL...');
            gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) {
                console.log('WebGL not supported, falling back to Canvas 2D');
                return false;
            }

            console.log('WebGL context obtained:', gl.getParameter(gl.VERSION));
            console.log('WebGL renderer:', gl.getParameter(gl.RENDERER));

            // Enable extensions for better performance
            const ext = gl.getExtension('OES_texture_float');
            if (ext) {
                console.log('OES_texture_float extension available');
            }

            // Create and compile shaders
            const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
            const fragmentShaderHorizontal = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderHorizontalSource);
            const fragmentShaderVertical = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderVerticalSource);
            
            if (!vertexShader || !fragmentShaderHorizontal || !fragmentShaderVertical) {
                console.log('Shader compilation failed, falling back to Canvas 2D');
                return false;
            }

            // Create programs for horizontal and vertical blur
            const programHorizontal = createProgram(gl, vertexShader, fragmentShaderHorizontal);
            const programVertical = createProgram(gl, vertexShader, fragmentShaderVertical);
            
            if (!programHorizontal || !programVertical) {
                console.log('Program creation failed, falling back to Canvas 2D');
                return false;
            }
            
            // Store the programs
            program = { horizontal: programHorizontal, vertical: programVertical };

            // Set up geometry
            setupGeometry();
            
            // Create texture
            texture = gl.createTexture();

            // Create intermediate texture and framebuffer
            intermediateTexture = gl.createTexture();
            framebuffer = gl.createFramebuffer();

            console.log('WebGL initialized successfully');
            return true;
        } catch (error) {
            console.log('WebGL initialization error:', error);
            return false;
        }
    };

    const createShader = (gl, type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    };

    const createProgram = (gl, vertexShader, fragmentShader) => {
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            return null;
        }
        
        return program;
    };

    const setupGeometry = () => {
        // Create a rectangle covering the entire canvas
        const positions = [
            -1, -1,  0, 1,
             1, -1,  1, 1,
            -1,  1,  0, 0,
             1,  1,  1, 0,
        ];
        
        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    };

    const renderWebGL = (canvas, video, canvasWidth, canvasHeight) => {
        try {
            // Downsample video frame onto temporary canvas
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            // Use 1/8th resolution for potentially better quality
            const tempWidth = Math.floor(videoWidth / 8);
            const tempHeight = Math.floor(videoHeight / 8);

            if (!tempCanvas) {
                tempCanvas = document.createElement('canvas');
                tempCanvasContext = tempCanvas.getContext('2d');
            }
            tempCanvas.width = tempWidth;
            tempCanvas.height = tempHeight;

            // Draw video frame to temporary canvas
            tempCanvasContext.drawImage(video, 0, 0, tempWidth, tempHeight);

            // Set the blur canvas size to the player container size for correct display
            // WebGL rendering will happen at the downsampled resolution
            canvas.width = canvasWidth; // playerContainer.clientWidth
            canvas.height = canvasHeight; // playerContainer.clientHeight

            // --- First pass: Horizontal blur to intermediate texture ---
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.bindTexture(gl.TEXTURE_2D, intermediateTexture);
            // Intermediate texture size matches the downsampled video frame size
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tempWidth, tempHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, intermediateTexture, 0);

            // Set viewport to the size of the intermediate texture (downsampled resolution)
            gl.viewport(0, 0, tempWidth, tempHeight);
            gl.useProgram(program.horizontal);

            // Update texture with content from the temporary canvas (downsampled video frame)
            gl.bindTexture(gl.TEXTURE_2D, texture);
            // Use UNPACK_FLIP_Y_WEBGL to flip the texture vertically during upload
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tempCanvas);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // Reset to default
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            // Set uniforms for horizontal pass
            let resolutionLocation = gl.getUniformLocation(program.horizontal, 'u_resolution');
            let textureLocation = gl.getUniformLocation(program.horizontal, 'u_texture');
            let blurRadiusLocation = gl.getUniformLocation(program.horizontal, 'u_blurRadius');

            gl.uniform2f(resolutionLocation, tempWidth, tempHeight); // Use downsampled resolution
            gl.uniform1i(textureLocation, 0);
            // Scale blur strength for horizontal pass
            gl.uniform1f(blurRadiusLocation, pluginSettings.blurStrength * (tempWidth / canvasWidth) * 2.5);

            // Set up attributes
            let positionLocation = gl.getAttribLocation(program.horizontal, 'a_position');
            let texCoordLocation = gl.getAttribLocation(program.horizontal, 'a_texCoord');

            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(texCoordLocation);
            gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8);

            // Draw to intermediate texture
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // --- Second pass: Vertical blur to screen ---
            gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Render to the main canvas
            // Set viewport to the size of the main canvas (player container size)
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            gl.useProgram(program.vertical);

            // Use the intermediate texture as input for the vertical pass
            gl.bindTexture(gl.TEXTURE_2D, intermediateTexture);

            // Set uniforms for vertical pass
            resolutionLocation = gl.getUniformLocation(program.vertical, 'u_resolution');
            textureLocation = gl.getUniformLocation(program.vertical, 'u_texture');
            blurRadiusLocation = gl.getUniformLocation(program.vertical, 'u_blurRadius');

            gl.uniform2f(resolutionLocation, tempWidth, tempHeight); // Use intermediate texture size
            gl.uniform1i(textureLocation, 0);
            // Scale blur strength for vertical pass
            gl.uniform1f(blurRadiusLocation, pluginSettings.blurStrength * (tempHeight / canvasHeight) * 2.5);

            // Set up attributes (same buffer, different program)
            positionLocation = gl.getAttribLocation(program.vertical, 'a_position');
            texCoordLocation = gl.getAttribLocation(program.vertical, 'a_texCoord');

            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(texCoordLocation);
            gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8);

            // Draw to screen
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            
            return true;
        } catch (error) {
            console.error('WebGL rendering error:', error);
            return false;
        }
    };

    const updateBackgroundFrame = async () => {
        // Use the stored references
        const player = playerInstance;
        const playerContainer = player.el(); // Get the main player DOM element

        if (!player || !blurCanvas || !videoElement || !playerContainer) {
            console.error('updateBackgroundFrame: Required elements not found.');
            stopUpdatingBackground();
            return;
        }

        // Check if blur is enabled
        if (!isBlurEnabled) {
            // Clear background if blur is disabled
            playerContainer.style.backgroundImage = '';
            // Continue the loop
            if (player && !player.paused()) {
                animationFrameId = requestAnimationFrame(updateBackgroundFrame);
            } else {
                animationFrameId = null;
            }
            return;
        }

        // Frame skipping for performance - only process every 2nd frame
        frameSkipCounter++;
        if (frameSkipCounter < 2) {
            // Skip this frame, but continue the loop
            if (player && !player.paused()) {
                animationFrameId = requestAnimationFrame(updateBackgroundFrame);
            } else {
                animationFrameId = null;
            }
            return;
        }
        frameSkipCounter = 0; // Reset counter

        // Use clientWidth/clientHeight for accurate rendered player dimensions
        const playerWidth = playerContainer.clientWidth;
        const playerHeight = playerContainer.clientHeight;
        const videoWidth = player.videoWidth();
        const videoHeight = player.videoHeight();

        // Check if dimensions are valid and video is ready
        if (playerWidth > 0 && playerHeight > 0 && videoWidth > 0 && videoHeight > 0 && videoElement.readyState >= 2) {
            
            const playerAspectRatio = playerWidth / playerHeight;
            const videoAspectRatio = videoWidth / videoHeight;

             if (Math.abs(playerAspectRatio - videoAspectRatio) > 0.001) {
                 // Use higher resolution for WebGL since it can handle it
                 const canvasWidth = useWebGL ? Math.floor(playerWidth / 2) : Math.floor(playerWidth / 4);
                 const canvasHeight = useWebGL ? Math.floor(playerHeight / 2) : Math.floor(playerHeight / 4);
                 
                 // Set canvas size
                 blurCanvas.width = canvasWidth;
                 blurCanvas.height = canvasHeight;

                 let dataURL = null;
                 
                 // Get blur strength from settings, default to 15 if not set
                 const blurStrength = pluginSettings.blurStrength || defaultPluginSettings.blurStrength;

                 if (useWebGL) {
                     // Use WebGL for GPU-accelerated blur
                     if (renderWebGL(blurCanvas, videoElement, canvasWidth, canvasHeight)) {
                         try {
                             dataURL = blurCanvas.toDataURL('image/jpeg', 0.8);
                         } catch (error) {
                             console.error('WebGL toDataURL error:', error);
                         }
                     }
                 } else {
                     // Fallback to Canvas 2D
                     try {
                         const context = blurCanvas.getContext('2d');
                         // Use blur strength for Canvas 2D filter
                         context.filter = `blur(${pluginSettings.blurStrength}px)`;
                         context.drawImage(videoElement, 0, 0, canvasWidth, canvasHeight);
                         context.filter = 'none';
                         dataURL = blurCanvas.toDataURL('image/jpeg', 0.7);
                     } catch (error) {
                         console.error('Canvas 2D error:', error);
                     }
                 }

                 if (dataURL && dataURL !== 'data:,') {
                    playerContainer.style.backgroundImage = `url(${dataURL})`;
                    playerContainer.style.backgroundSize = 'cover';
                    playerContainer.style.backgroundPosition = 'center';
                 } else {
                    playerContainer.style.backgroundImage = '';
                 }
             } else {
                 // No letterboxing - clear background image
                 playerContainer.style.backgroundImage = '';
             }
        } else {
             // Clear background if conditions not met
             playerContainer.style.backgroundImage = '';
        }

        // Continue the loop with requestAnimationFrame for 60fps
         if (player && !player.paused()) {
            animationFrameId = requestAnimationFrame(updateBackgroundFrame);
         } else {
             animationFrameId = null;
         }
    };

    const startUpdatingBackground = () => {
        console.log('Attempting to start background update loop.');
        if (!animationFrameId && playerInstance) {
            console.log(`Background update loop not running. Starting ${useWebGL ? 'WebGL' : 'Canvas 2D'} update loop.`);
            frameSkipCounter = 0; // Reset frame skip counter
            animationFrameId = requestAnimationFrame(updateBackgroundFrame);
        } else if (animationFrameId) {
            console.log('Background update loop already running.');
        } else {
             console.log('Player instance not available, not starting loop.');
        }
    };

    const stopUpdatingBackground = () => {
        console.log('Attempting to stop background update loop.');
        if (animationFrameId) {
            console.log('Cancelling animation frame:', animationFrameId);
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
            frameSkipCounter = 0; // Reset frame skip counter
            console.log('Background update loop explicitly stopped.');
        } else {
            console.log('Background update loop not running, nothing to stop.');
        }
    };

    const updateLetterboxVisibility = (player) => {
        const playerContainer = player.el(); // Get the main player DOM element
        const videoWidth = player.videoWidth();
        const videoHeight = player.videoHeight();
        const playerWidth = playerContainer.clientWidth;
        const playerHeight = playerContainer.clientHeight;

        console.log(`updateLetterboxVisibility called. Player: ${playerWidth}x${playerHeight}, Video: ${videoWidth}x${videoHeight}. Video readyState: ${videoElement ? videoElement.readyState : 'N/A'}, Player readyState: ${player.readyState()}`);

        // Clear background if dimensions are zero or not ready
        if (playerWidth === 0 || playerHeight === 0 || videoWidth === 0 || videoHeight === 0 || !videoElement || videoElement.readyState < 1 || player.readyState() < 1) {
             console.log('updateLetterboxVisibility: Dimensions zero, metadata/data not loaded, or player not ready. Clearing background.');
             playerContainer.style.filter = ''; // Ensure filter is clear
             playerContainer.style.backgroundImage = ''; // Clear background image
             playerContainer.style.backgroundColor = ''; // Clear temporary background color
        } else {
             // Dimensions are valid and video is ready - background handled by updateBackgroundFrame
             console.log('updateLetterboxVisibility: Dimensions valid and video ready. Background handled by updateBackgroundFrame.');
             playerContainer.style.backgroundColor = ''; // Remove temporary color if it was set
        }
    };

    // Create a simple toggle button using DOM manipulation
    const createSimpleToggleButton = () => {
        // Load blur state from localStorage
        const savedState = localStorage.getItem('letterboxBlurEnabled');
        if (savedState !== null) {
            isBlurEnabled = savedState === 'true';
        }

        // Create button element
        toggleButton = document.createElement('button');
        toggleButton.className = 'vjs-control vjs-button letterbox-blur-toggle';
        toggleButton.type = 'button';
        toggleButton.setAttribute('aria-disabled', 'false');
        
        // Update button appearance
        updateToggleButton();
        
        // Add click handler
        toggleButton.addEventListener('click', () => {
            // Toggle blur state
            isBlurEnabled = !isBlurEnabled;
            
            // Save state to localStorage
            localStorage.setItem('letterboxBlurEnabled', isBlurEnabled.toString());
            
            // Update button appearance
            updateToggleButton();
            
            // If disabled, clear background immediately
            if (!isBlurEnabled && playerInstance) {
                const playerContainer = playerInstance.el();
                playerContainer.style.backgroundImage = '';
            }
            
            console.log('Letterbox blur toggled:', isBlurEnabled ? 'ON' : 'OFF');
        });

        return toggleButton;
    };

    const updateToggleButton = () => {
        if (!toggleButton) return;
        
        if (isBlurEnabled) {
            toggleButton.innerHTML = '<span style="font-size: 1.2em;">🌫️</span>';
            toggleButton.title = 'Disable Letterbox Blur';
            toggleButton.style.opacity = '1';
        } else {
            toggleButton.innerHTML = '<span style="font-size: 1.2em; opacity: 0.6;">🚫</span>';
            toggleButton.title = 'Enable Letterbox Blur';
            toggleButton.style.opacity = '0.6';
        }
    };

    // Add CSS styles for the button
    const addButtonStyles = () => {
        const style = document.createElement('style');
        style.textContent = `
            .letterbox-blur-toggle {
                cursor: pointer;
                margin: 0 0.5em;
                padding: 0.5em;
                background: transparent;
                border: none;
                color: inherit;
            }
            
            .letterbox-blur-toggle:hover {
                opacity: 0.8 !important;
            }
        `;
        document.head.appendChild(style);
    };

    const setupLetterboxBlur = async (playerElement) => {
        console.log('LetterboxBlur plugin initializing for player.');

        try {
            // Access the player instance directly from the element
            playerInstance = playerElement.player; // Store player instance
            const playerContainer = playerInstance.el(); // Get the main player DOM element
            videoElement = playerInstance.tech().el(); // Get and store the actual video element
            const videoParentNode = videoElement.parentNode; // Get the parent of the video element

            console.log('Player instance obtained.', playerInstance);
            console.log('Player container obtained.', playerContainer);
            console.log('Video element obtained.', videoElement);

            if (!playerContainer || !videoElement || !videoParentNode) {
                console.error('Required player elements not found during setup.');
                return;
            }

            // Create blur canvas if it doesn't exist
            blurCanvas = playerContainer.querySelector('.letterbox-blur-canvas');

            if (!blurCanvas) {
                blurCanvas = document.createElement('canvas');
                blurCanvas.classList.add('letterbox-blur-canvas');
                blurCanvas.style.display = 'none'; // Hide the canvas
                playerContainer.appendChild(blurCanvas);
                console.log('Created and appended blur canvas to player container.', blurCanvas);
            } else {
                console.log('Blur canvas element already exists.', blurCanvas);
            }

            // Initialize WebGL
            useWebGL = initWebGL(blurCanvas);
            if (useWebGL) {
                console.log('Using WebGL for GPU-accelerated blur rendering');
            } else {
                console.log('Using Canvas 2D fallback for blur rendering');
            }
            
            // Fetch plugin settings
            try {
                const fetchedSettings = await csLib.getConfiguration('LetterboxBlur', {});
                pluginSettings = { ...defaultPluginSettings, ...fetchedSettings };
                console.log('Plugin settings loaded:', pluginSettings);
            } catch (error) {
                console.error('Error loading plugin settings:', error);
                pluginSettings = { ...defaultPluginSettings }; // Use default settings on error
            }

            // Add CSS styles for the button
            addButtonStyles();

            // Create and add the toggle button
            const button = createSimpleToggleButton();
            
            // Add button to control bar after a short delay to ensure Video.js is ready
            setTimeout(() => {
                const controlBar = playerContainer.querySelector('.vjs-control-bar');
                if (controlBar) {
                    // Insert before the fullscreen button
                    const fullscreenButton = controlBar.querySelector('.vjs-fullscreen-control');
                    if (fullscreenButton) {
                        controlBar.insertBefore(button, fullscreenButton);
                    } else {
                        controlBar.appendChild(button);
                    }
                    console.log('Letterbox blur toggle button added to control bar');
                } else {
                    console.error('Control bar not found');
                }
            }, 1000);

            // Ensure the video element is positioned correctly above the background
            videoElement.style.position = 'relative'; // Needs positioning to respect z-index
            videoElement.style.zIndex = '2'; // Position above background
            videoElement.style.objectFit = 'contain'; // Ensure video maintains aspect ratio
            console.log('Set video element position, z-index, and object-fit.');

            // Ensure player controls are visible above the background and video
            const playerControls = playerContainer.querySelector('.vjs-control-bar');
            if (playerControls) {
                 playerControls.style.zIndex = '3'; // Position above video element
                 console.log('Set player controls z-index.', playerControls);
            }
             const bigPlayButton = playerContainer.querySelector('.vjs-big-play-button');
             if (bigPlayButton) {
                 bigPlayButton.style.zIndex = '3'; // Position above video element
                 console.log('Set big play button z-index.', bigPlayButton);
             }

            // Use ResizeObserver to detect changes in player container size
            const resizeObserver = new ResizeObserver(entries => {
                for (let entry of entries) {
                    if (entry.target === playerContainer) {
                        console.log('Player container resized detected by ResizeObserver.');
                        updateLetterboxVisibility(playerInstance);
                    }
                }
            });

            // Observe the player container for size changes
            resizeObserver.observe(playerContainer);

            // Also run initial visibility update
            console.log('Initial updateLetterboxVisibility call during setup.');
            updateLetterboxVisibility(playerInstance);

            // Call updateLetterboxVisibility when video metadata or data is loaded
            playerInstance.on('loadedmetadata', () => {
                console.log('Video loadedmetadata event fired.');
                updateLetterboxVisibility(playerInstance);
            });
            playerInstance.on('loadeddata', () => {
                console.log('Video loadeddata event fired.');
                updateLetterboxVisibility(playerInstance);
            });

            // Start/stop background update with video playback
            playerInstance.on('play', startUpdatingBackground);
            playerInstance.on('pause', stopUpdatingBackground);
            playerInstance.on('ended', stopUpdatingBackground);

            // Initial background update loop start if video is already playing and ready
            if (videoElement && videoElement.readyState >= 1 && playerInstance.readyState() >= 1 && !playerInstance.paused()) {
                console.log('Video is already playing and ready, starting background update loop initially.');
                startUpdatingBackground();
            } else {
                 console.log('Video not initially playing or ready, not starting loop initially.');
            }

            console.log('LetterboxBlur plugin initialization complete.');
        } catch (error) {
            console.error('Error during LetterboxBlur setup:', error);
        }
    };

    // Use CommunityScriptsUILibrary's PathElementListener to wait for the video player on scene pages
    csLib.PathElementListener(
        "/scenes/",
        "#VideoJsPlayer", // Use the specific ID used by VideoScrollWheel
        setupLetterboxBlur
    );

})(); 