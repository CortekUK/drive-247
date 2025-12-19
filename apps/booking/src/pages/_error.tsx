import { NextPage } from 'next';

interface ErrorProps {
  statusCode?: number;
}

const Error: NextPage<ErrorProps> = ({ statusCode }) => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#1a1a1a',
      color: '#ffffff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>
        {statusCode || 'Error'}
      </h1>
      <p style={{ fontSize: '1.25rem', marginBottom: '2rem' }}>
        {statusCode === 404
          ? 'Page not found'
          : 'An error occurred'}
      </p>
      <a
        href="/"
        style={{
          padding: '0.75rem 1.5rem',
          backgroundColor: '#C6A256',
          color: '#ffffff',
          border: 'none',
          borderRadius: '0.5rem',
          textDecoration: 'none',
          fontSize: '1rem',
        }}
      >
        Return Home
      </a>
    </div>
  );
};

Error.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;
