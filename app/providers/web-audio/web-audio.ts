// Copyright (c) 2016 Tracktunes Inc


const CONTEXT = new (AudioContext || webkitAudioContext)();


/*****************************************************************************
 * RECORDER
 *****************************************************************************/

export class WebAudioRecorder {
    // 'instance' is used as part of Singleton pattern implementation
    private static instance: WebAudioRecorder = null;
    private audioGainNode: AudioGainNode;
    private mediaRecorder: MediaRecorder;
    private analyserNode: AnalyserNode;
    private analyserBuffer: Uint8Array;
    private analyserBufferLength: number;
    private sourceNode: MediaElementAudioSourceNode;
    private blobChunks: Blob[] = [];
    private playbackSourceNode: AudioBufferSourceNode;
    private ready: boolean = false;
    private fileReader: FileReader;

    // time related
    private recordStartTime: number = 0;
    private recordLastPauseTime: number = 0;
    private recordTotalPauseTime: number = 0;

    getRecordingTime() {
        return CONTEXT.currentTime -
            this.recordStartTime -
            this.recordTotalPauseTime;
    }

    // gets called with the recorded blob as soon as we're done recording
    onStopRecord: (recordedBlob: Blob) => void;

    // 'instance' is used as part of Singleton pattern implementation
    constructor() {
        console.log('constructor():WebAudioPlayer');
        this.initWebAudio();
    }

    /**
     * Access the singleton class instance via Singleton.Instance
     * @returns {Singleton} the single instance of this class
     */
    static get Instance() {
        if (!this.instance) {
            this.instance = new WebAudioRecorder();
        }
        return this.instance;
    }

    /**
     * Initialize audio, get it ready to record
     * @returns {void}
     */
    initWebAudio() {
        if (!CONTEXT) {
            throw Error('AudioContext not available!');
        }

        console.log('SAMPLE RATE: ' + CONTEXT.sampleRate);

        let getUserMediaOptions = { video: false, audio: true };

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            // new getUserMedia is available, use it to get microphone stream
            console.log('Using NEW navigator.mediaDevices.getUserMedia');
            navigator.mediaDevices.getUserMedia(getUserMediaOptions)
                .then((stream: MediaStream) => {
                    this.setUpNodes(stream);
                })
                .catch((error: any) => {
                    this.noMicrophoneAlert(error);
                });
        }
        else {
            console.log('Using OLD navigator.getUserMedia (new not there)');
            // new getUserMedia not there, try the old one
            navigator.getUserMedia = navigator.getUserMedia ||
                navigator.webkitGetUserMedia ||
                navigator.mozGetUserMedia ||
                navigator.msGetUserMedia;
            if (navigator.getUserMedia) {
                // old getUserMedia is available, use it
                try {
                    navigator.getUserMedia(
                        getUserMediaOptions,
                        (stream: MediaStream) => {
                            // ok we got a microphone
                            this.setUpNodes(stream);
                        },
                        (error: any) => {
                            this.noMicrophoneAlert(error);
                        });
                }
                catch (error) {
                    alert('eyah!');
                }
            }
            else {
                // neither old nor new getUserMedia are available
                alert([
                    'Your browser does not support the function ',
                    'getUserMedia(), please upgrade to one of the ',
                    'browsers supported by this app. Until you do so ',
                    'you will not be able to use the recording part of ',
                    'this app, but you will be able to play back audio.'
                ].join(''));
            }
        }
    }

    noMicrophoneAlert(error: any) {
        let msg = [
            'This app needs the microphone to record audio with.',
            'Your browser got no access to your microphone - ',
            'if you are running this app on a desktop, perhaps ',
            'your microphone is not connected? If so, please ',
            'connect your microphone and reload this page.'
        ].join('');
        if (error.name !== 'DevicesNotFoundError') {
            msg += [
                '\n\nError: ', error,
                '\nError name: ', error.name,
                '\nError message: ', error.message
            ].join('');
        }
        alert(msg);
    }

    /**
     * Create new MediaRecorder and set up its callbacks
     * @param {MediaStream} stream the stream obtained by getUserMedia
     * @returns {void}
     */
    initMediaRecorder(stream: MediaStream) {
        if (!MediaRecorder) {
            alert('MediaRecorder not available!');
            let msg = [
                'Your browser does not support the MediaRecorder object ',
                'used for recording audio, please upgrade to one of the ',
                'browsers supported by this app. Until you do so ',
                'you will not be able to use the recording part of ',
                'this app, but you will be able to play back audio.'
            ].join('');
        }

        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm'
        });

        if (MediaRecorder.isTypeSupported === undefined) {
            console.warn('MediaRecorder.isTypeSupported() is undefined!');
        }
        else {
            if (MediaRecorder.isTypeSupported('audio/wav')) {
                console.log('audio/wav SUPPORTED');
            }
            else if (MediaRecorder.isTypeSupported('audio/ogg')) {
                console.log('audio/ogg SUPPORTED');
            }
            else if (MediaRecorder.isTypeSupported('audio/mp3')) {
                console.log('audio/mp3 SUPPORTED');
            }
            else if (MediaRecorder.isTypeSupported('audio/m4a')) {
                console.log('audio/m4a SUPPORTED');
            }
            else if (MediaRecorder.isTypeSupported('audio/webm')) {
                console.log('audio/webm SUPPORTED');
            }
            else {
                console.warn('Could not find supported type');
            }
        }

        this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
            // console.log('ondataavailable()');
            this.blobChunks.push(event.data);
        };

        this.mediaRecorder.onstop = (event: Event) => {
            console.log('mediaRecorder.onStop() Got ' +
                this.blobChunks.length + ' chunks');

            if (!this.onStopRecord) {
                throw Error('WebAudioRecorder:onStop() not set!');
            }

            // let blob: Blob = new Blob(this.blobChunks, {
            //     type: 'audio/webm'
            // });
            let blob: Blob = new Blob(this.blobChunks);

            this.onStopRecord(blob);

            this.blobChunks = [];
        };

        // finally let users of this class know it's ready
        this.ready = true;
    }

    /**
     * Create Analyser and Gain nodes and connect them to a
     * MediaStreamDestination node, which is fed to MediaRecorder
     * @param {MediaStream} stream the stream obtained by getUserMedia
     * @returns {void}
     */
    setUpNodes(stream: MediaStream) {
        console.log('WebAudioRecorder:setUpRecording()');

        // create the gainNode
        this.audioGainNode = CONTEXT.createGain();

        // create and configure the analyserNode
        this.analyserNode = CONTEXT.createAnalyser();
        this.analyserNode.fftSize = 2048;
        this.analyserBufferLength = this.analyserNode.frequencyBinCount;
        this.analyserBuffer = new Uint8Array(this.analyserBufferLength);

        // create a source node out of the audio media stream
        this.sourceNode = CONTEXT.createMediaStreamSource(stream);

        // create a destination node
        let dest: MediaStreamAudioDestinationNode =
            CONTEXT.createMediaStreamDestination();

        // sourceNode (microphone) -> gainNode
        this.sourceNode.connect(this.audioGainNode);

        // gainNode -> destination
        this.audioGainNode.connect(dest);

        // gainNode -> analyserNode
        this.audioGainNode.connect(this.analyserNode);

        // this.initMediaRecorder(stream);
        this.initMediaRecorder(dest.stream);
    }

    /**
     * Compute the current latest buffer frame max volume and return it
     * @returns {number} max volume in range of [0,128]
     */
    getBufferMaxVolume() {
        if (!this.analyserNode) {
            return 0;
        }

        let i: number, bufferMax: number = 0, absValue: number;
        this.analyserNode.getByteTimeDomainData(this.analyserBuffer);
        for (i = 0; i < this.analyserBufferLength; i++) {
            absValue = Math.abs(this.analyserBuffer[i] - 128.0);
            if (absValue > bufferMax) {
                bufferMax = absValue;
            }
        }
        return bufferMax;
    }

    /**
     * Set the multiplier on input volume (gain) effectively changing volume
     * @param {number} factor fraction of volume, where 1.0 is no change
     * @returns {void}
     */
    setGainFactor(factor: number) {
        if (!this.audioGainNode) {
            throw Error('GainNode not initialized!');
        }
        this.audioGainNode.gain.value = factor;
    }

    /**
     * Are we recording right now?
     * @returns {boolean} whether we are recording right now
     */
    isRecording() {
        return this.mediaRecorder &&
            (this.mediaRecorder.state === 'recording');
    }

    /**
     * Is MediaRecorder state inactive now?
     * @returns {boolean} whether MediaRecorder is inactive now
     */
    recordingInactive() {
        // TODO: get rid of !this.mediaRecorder here and everywhere
        // else
        return !this.mediaRecorder ||
            this.mediaRecorder.state === 'inactive';
    }

    /**
     * Start recording
     * @returns {void}
     */
    startRecording() {
        if (!this.mediaRecorder) {
            throw Error('MediaRecorder not initialized! (1)');
        }
        // TODO: play around with putting the next line
        // either immediately below or immediately above the
        // start() call
        this.recordStartTime = CONTEXT.currentTime;
        this.mediaRecorder.start();
    }

    /**
     * Pause recording
     * @returns {void}
     */
    pauseRecording() {
        if (!this.mediaRecorder) {
            throw Error('MediaRecorder not initialized! (2)');
        }
        // TODO: play around with putting the next line
        // either immediately below or immediately above the
        // pause() call
        this.mediaRecorder.pause();
        this.recordLastPauseTime = CONTEXT.currentTime;
    }

    /**
     * Resume recording
     * @returns {void}
     */
    resumeRecording() {
        if (!this.mediaRecorder) {
            throw Error('MediaRecorder not initialized! (3)');
        }
        // TODO: play around with putting the next line
        // either immediately below or immediately above the
        // resume() call
        this.mediaRecorder.resume();
        this.recordTotalPauseTime +=
            CONTEXT.currentTime - this.recordLastPauseTime;
    }

    /**
     * Stop recording
     * @returns {void}
     */
    stopRecording() {
        if (!this.mediaRecorder) {
            throw Error('MediaRecorder not initialized! (4)');
        }
        this.recordTotalPauseTime = 0;
        this.mediaRecorder.stop();
    }
}

/*****************************************************************************
 * PLAYER
 * Based on code by Ian McGregor: http://codepen.io/ianmcgregor/pen/EjdJZZ
 *****************************************************************************/

export class WebAudioPlayer {
    // 'instance' is used as part of Singleton pattern implementation
    private static instance: WebAudioPlayer = null;
    private fileReader: FileReader = new FileReader();
    private audioBuffer: AudioBuffer;
    private sourceNode: AudioBufferSourceNode = null;
    private startedAt: number = 0;
    private pausedAt: number = 0;
    isPlaying: boolean = false;

    constructor() {
        console.log('constructor():WebAudioPlayer');
    }

    /**
     * Access the singleton class instance via Singleton.Instance
     * @returns {Singleton} the single instance of this class
     */
    static get Instance() {
        if (!this.instance) {
            this.instance = new WebAudioPlayer();
        }
        return this.instance;
    }

    getTime() {
        if (this.pausedAt) {
            return this.pausedAt;
        }
        if (this.startedAt) {
            return CONTEXT.currentTime - this.startedAt;
        }
        return 0;
    }

    getDuration() {
        return this.audioBuffer.duration;
    }

    loadAndDecode(
        blob: Blob,
        successCB: (duration: number) => void,
        loadErrorCB: () => void,
        decodeErrorCB: () => void
    ) {
        this.fileReader.onerror = loadErrorCB;
        this.fileReader.onload = () => {
            console.log('fileReader.onload()');
            CONTEXT.decodeAudioData(this.fileReader.result,
                (audioBuffer: AudioBuffer) => {
                    this.audioBuffer = audioBuffer;
                    successCB(audioBuffer.duration);
                }, decodeErrorCB);
        };
        this.fileReader.readAsArrayBuffer(blob);
    }

    play() {
        let offset = this.pausedAt;

        this.sourceNode = CONTEXT.createBufferSource();
        this.sourceNode.connect(CONTEXT.destination);
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.start(0, offset);

        this.startedAt = CONTEXT.currentTime - offset;
        this.pausedAt = 0;
        this.isPlaying = true;
    }

    pause() {
        let elapsed: number = CONTEXT.currentTime - this.startedAt;
        this.stop();
        this.pausedAt = elapsed;
    }

    stop() {
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode.stop(0);
            this.sourceNode = null;
        }
        this.startedAt = 0;
        this.pausedAt = 0;
        this.isPlaying = false;
    }

    seek(time: number) {
        let isPlaying: boolean = this.isPlaying;
        this.isPlaying = false;
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode.stop(0);
            this.sourceNode = null;
        }
        this.sourceNode = CONTEXT.createBufferSource();
        this.sourceNode.connect(CONTEXT.destination);
        this.sourceNode.buffer = this.audioBuffer;
        if (isPlaying) {
            this.sourceNode.start(0, time);
            this.startedAt = CONTEXT.currentTime - time;
            this.pausedAt = 0;
        }
        this.isPlaying = isPlaying;
    }
}
