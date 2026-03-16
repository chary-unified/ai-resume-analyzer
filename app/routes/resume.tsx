import {Link, useNavigate, useParams} from "react-router";
import {useEffect, useState} from "react";
import {usePuterStore} from "~/lib/puter";
import Summary from "~/components/Summary";
import ATS from "~/components/ATS";
import Details from "~/components/Details";
import {coerceFeedback, createFallbackFeedback, parseFeedbackResponse} from "~/lib/utils";
import {prepareInstructions} from "../../constants";

const ANALYSIS_TIMEOUT_MS = 90000;

const runWithTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Analysis is taking longer than expected. Please try again.'));
        }, timeoutMs);

        promise
            .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

export const meta = () => ([
    { title: 'Resumind | Review ' },
    { name: 'description', content: 'Detailed overview of your resume' },
])

const Resume = () => {
    const { auth, isLoading, fs, kv, ai } = usePuterStore();
    const { id } = useParams();
    const [imageUrl, setImageUrl] = useState('');
    const [resumeUrl, setResumeUrl] = useState('');
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const [statusText, setStatusText] = useState('Scanning your resume...');
    const [progress, setProgress] = useState(10);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const navigate = useNavigate();

    useEffect(() => {
        if(!isLoading && !auth.isAuthenticated) navigate(`/auth?next=/resume/${id}`);
    }, [isLoading])

    useEffect(() => {
        let isCancelled = false;
        const objectUrls: string[] = [];

        const loadResume = async () => {
            try {
                if (!id) {
                    throw new Error('Invalid resume link. Please open the resume again from home.');
                }

                setAnalysisError(null);
                setStatusText('Fetching resume data...');
                setProgress(15);

                const resume = await kv.get(`resume:${id}`);
                if (!resume) {
                    throw new Error('Resume data was not found. Please upload again.');
                }

                const data = JSON.parse(resume);

                setStatusText('Loading resume files...');
                setProgress(30);

                try {
                    const resumeBlob = await fs.read(data.resumePath);
                    if (resumeBlob) {
                        const pdfBlob = new Blob([resumeBlob], { type: 'application/pdf' });
                        const currentResumeUrl = URL.createObjectURL(pdfBlob);
                        objectUrls.push(currentResumeUrl);
                        if (isCancelled) return;
                        setResumeUrl(currentResumeUrl);
                    }
                } catch {
                    setResumeUrl('');
                }

                try {
                    const imageBlob = await fs.read(data.imagePath);
                    if (imageBlob) {
                        const currentImageUrl = URL.createObjectURL(imageBlob);
                        objectUrls.push(currentImageUrl);
                        if (isCancelled) return;
                        setImageUrl(currentImageUrl);
                    }
                } catch {
                    setImageUrl('');
                }

                let resolvedFeedback = coerceFeedback(data.feedback);

                if (!resolvedFeedback) {
                    try {
                        setStatusText('Analyzing resume against job details...');
                        setProgress(55);

                        const aiResponse = await runWithTimeout(
                            ai.feedback(
                                data.resumePath,
                                prepareInstructions({
                                    jobTitle: data.jobTitle || '',
                                    jobDescription: data.jobDescription || '',
                                })
                            ),
                            ANALYSIS_TIMEOUT_MS
                        );

                        setStatusText('Generating insights and score...');
                        setProgress(80);

                        if (!aiResponse) {
                            throw new Error('AI response was empty.');
                        }

                        resolvedFeedback = parseFeedbackResponse(aiResponse.message.content);

                        if (!resolvedFeedback) {
                            throw new Error('AI returned an invalid response.');
                        }
                    } catch {
                        setStatusText('AI service unavailable. Generating baseline insights...');
                        setProgress(85);
                        resolvedFeedback = createFallbackFeedback({
                            jobTitle: data.jobTitle,
                            jobDescription: data.jobDescription,
                        });
                    }

                    data.feedback = resolvedFeedback;
                    await kv.set(`resume:${id}`, JSON.stringify(data));
                }

                if (isCancelled) return;
                setFeedback(resolvedFeedback);
                setStatusText('Insights ready.');
                setProgress(100);
            } catch (error) {
                if (isCancelled) return;
                const message = error instanceof Error ? error.message : 'Failed to analyze resume';
                setFeedback(null);
                setAnalysisError(message);
                setStatusText('Analysis paused. Please retry.');
            }
        }

        loadResume();

        return () => {
            isCancelled = true;
            objectUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [id, retryCount]);

    const analysisSteps = [
        'Fetching resume data',
        'Loading uploaded files',
        'Running AI analysis',
        'Building insights',
    ];

    const completedSteps = Math.min(
        analysisSteps.length,
        Math.max(0, Math.floor((progress / 100) * analysisSteps.length))
    );

    return (
        <main className="!pt-0">
            <nav className="resume-nav">
                <Link to="/" className="back-button">
                    <img src="/icons/back.svg" alt="logo" className="w-2.5 h-2.5" />
                    <span className="text-gray-800 text-sm font-semibold">Back to Homepage</span>
                </Link>
            </nav>
            <div className="flex flex-row w-full max-lg:flex-col-reverse">
                <section className="feedback-section bg-[url('/images/bg-small.svg')] bg-cover h-[100vh] sticky top-0 items-center justify-center">
                    {imageUrl && resumeUrl && (
                        <div className="animate-in fade-in duration-1000 gradient-border max-sm:m-0 h-[90%] max-wxl:h-fit w-fit">
                            <a href={resumeUrl} target="_blank" rel="noopener noreferrer">
                                <img
                                    src={imageUrl}
                                    className="w-full h-full object-contain rounded-2xl"
                                    title="resume"
                                />
                            </a>
                        </div>
                    )}
                </section>
                <section className="feedback-section">
                    <h2 className="text-4xl !text-black font-bold">Resume Review</h2>
                    {feedback ? (
                        <div className="flex flex-col gap-8 animate-in fade-in duration-1000">
                            <Summary feedback={feedback} />
                            <ATS score={feedback.ATS.score || 0} suggestions={feedback.ATS.tips || []} />
                            <Details feedback={feedback} />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-4 w-full max-w-2xl">
                            <img src="/images/resume-scan-2.gif" alt="Resume scanning animation" className="w-full" />
                            <p className="text-gray-600 text-lg">{statusText}</p>
                            <progress
                                className="w-full h-2 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-gray-200 [&::-webkit-progress-value]:bg-blue-500 [&::-moz-progress-bar]:bg-blue-500"
                                value={progress}
                                max={100}
                            />
                            <p className="text-sm text-gray-500">{progress}% complete</p>
                            <div className="w-full rounded-xl bg-gray-50 p-4 border border-gray-200">
                                {analysisSteps.map((step, index) => {
                                    const isDone = index < completedSteps;
                                    const isActive = index === completedSteps;

                                    return (
                                        <p
                                            key={step}
                                            className={`text-sm ${isDone ? 'text-green-700' : isActive ? 'text-blue-700' : 'text-gray-500'}`}
                                        >
                                            {isDone ? 'Done' : isActive ? 'In progress' : 'Pending'}: {step}
                                        </p>
                                    );
                                })}
                            </div>
                            {analysisError && (
                                <div className="w-full rounded-xl border border-red-200 bg-red-50 p-4 flex flex-col gap-3">
                                    <p className="text-sm text-red-700">{analysisError}</p>
                                    <button
                                        type="button"
                                        className="primary-button"
                                        onClick={() => {
                                            setRetryCount((count) => count + 1);
                                            setStatusText('Retrying analysis...');
                                            setProgress(20);
                                            setAnalysisError(null);
                                        }}
                                    >
                                        Try Again
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
export default Resume
