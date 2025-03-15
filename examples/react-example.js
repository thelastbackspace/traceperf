// This is an example of using TracePerf in a React application

// Import the browser version of TracePerf
import tracePerf from 'traceperf/browser';

// Example React component with performance tracking
function ExampleComponent() {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  // Function to fetch data with performance tracking
  const fetchData = async () => {
    tracePerf.info('Fetching data from API');
    setLoading(true);
    setError(null);

    try {
      // Track the API call
      const result = await tracePerf.track(async () => {
        const response = await fetch('https://api.example.com/data');
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      }, { label: 'API_FETCH', threshold: 300 });

      // Process the data with tracking
      const processedData = tracePerf.track(() => {
        tracePerf.debug('Processing API response');
        // Simulate data processing
        return result.map(item => ({
          ...item,
          processed: true,
          timestamp: new Date().toISOString()
        }));
      }, { label: 'PROCESS_DATA' });

      setData(processedData);
      tracePerf.info('Data fetched and processed successfully');
    } catch (err) {
      setError(err.message);
      tracePerf.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Use nested logging for component lifecycle
  React.useEffect(() => {
    tracePerf.group('Component Lifecycle');
    tracePerf.info('Component mounted');

    // Fetch data on mount
    fetchData();

    // Clean up
    return () => {
      tracePerf.info('Component unmounting');
      tracePerf.groupEnd();
    };
  }, []);

  // Conditional rendering with debug logs
  if (loading) {
    tracePerf.debug('Rendering loading state');
    return <div>Loading...</div>;
  }

  if (error) {
    tracePerf.debug('Rendering error state');
    return <div>Error: {error}</div>;
  }

  if (!data) {
    tracePerf.debug('Rendering empty state');
    return <div>No data available</div>;
  }

  tracePerf.debug('Rendering data', { count: data.length });
  return (
    <div>
      <h1>Data</h1>
      <ul>
        {data.map(item => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
      <button onClick={fetchData}>Refresh Data</button>
    </div>
  );
}

// Example of using TracePerf in a custom hook
function useTracedState(initialState) {
  const [state, setState] = React.useState(initialState);
  
  const tracedSetState = React.useCallback((newState) => {
    tracePerf.track(() => {
      setState(typeof newState === 'function' ? newState(state) : newState);
    }, { label: 'setState', threshold: 5 });
  }, [state]);
  
  return [state, tracedSetState];
}

// Example of setting different modes based on environment
if (process.env.NODE_ENV === 'production') {
  tracePerf.setMode('prod');
} else if (process.env.NODE_ENV === 'test') {
  tracePerf.setMode('staging');
} else {
  tracePerf.setMode('dev');
}

export default ExampleComponent; 