import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

function App() {
    const [tasks, setTasks] = useState([]);
    const [newTask, setNewTask] = useState('');
    const [loading, setLoading] = useState(true);
    const [source, setSource] = useState('');

    const fetchTasks = async () => {
        try {
            const response = await fetch(`${API_URL}/tasks`);
            const data = await response.json();
            setTasks(data.tasks);
            setSource(data.source);
            setLoading(false);
        } catch (error) {
            console.error('Error fetching tasks:', error);
            setLoading(false);
        }
    };

    useEffect(() => { fetchTasks(); }, []);

    const addTask = async (e) => {
        e.preventDefault();
        if (!newTask.trim()) return;
        try {
            await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTask })
            });
            setNewTask('');
            fetchTasks();
        } catch (error) {
            console.error('Error adding task:', error);
        }
    };

    const toggleTask = async (id, completed) => {
        try {
            await fetch(`${API_URL}/tasks/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completed: !completed })
            });
            fetchTasks();
        } catch (error) {
            console.error('Error updating task:', error);
        }
    };

    const deleteTask = async (id) => {
        try {
            await fetch(`${API_URL}/tasks/${id}`, { method: 'DELETE' });
            fetchTasks();
        } catch (error) {
            console.error('Error deleting task:', error);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #1a1a2f 0%, #16213f 60%, #265998 100%)',
            padding: '2rem',
            fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
            <div style={{
                maxWidth: '600px',
                margin: '0 auto',
                background: 'rgba(255,255,255,0.1)',
                backdropFilter: 'blur(10px)',
                borderRadius: '1rem',
                padding: '2rem',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
            }}>
                <h1 style={{ color: '#eb092f', textAlign: 'center', marginBottom: '1.5rem', fontSize: '2rem' }}>
                    🐳 Todo App — Lab 7 Observability
                </h1>

                <div style={{
                    textAlign: 'center',
                    marginBottom: '1rem',
                    padding: '0.5rem',
                    background: source === 'cache' ? '#6aeabf' : '#ee0dba',
                    borderRadius: '0.5rem',
                    color: 'white',
                    fontSize: '0.875rem'
                }}>
                    Data source: {source || 'loading...'}
                </div>

                <form onSubmit={addTask} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                    <input
                        type="text"
                        value={newTask}
                        onChange={e => setNewTask(e.target.value)}
                        placeholder="Добавить задачу..."
                        style={{
                            flex: 1, padding: '0.75rem 1rem', border: 'none',
                            borderRadius: '0.5rem', fontSize: '1rem', background: 'rgba(255,255,255,1)'
                        }}
                    />
                    <button type="submit" style={{
                        padding: '0.75rem 1.5rem', background: '#df8393', color: 'white',
                        border: 'none', borderRadius: '0.5rem', cursor: 'pointer',
                        fontSize: '1rem', fontWeight: 'bold'
                    }}>Добавить</button>
                </form>

                {loading ? (
                    <p style={{ color: 'white', textAlign: 'center' }}>Загрузка...</p>
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {tasks.map(task => (
                            <li key={task.id} style={{
                                display: 'flex', alignItems: 'center', gap: '0.75rem',
                                padding: '1rem', background: 'rgba(255,255,255,0.1)',
                                borderRadius: '0.5rem', marginBottom: '0.5rem'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={task.completed}
                                    onChange={() => toggleTask(task.id, task.completed)}
                                    style={{ width: '1.25rem', height: '1.25rem', cursor: 'pointer' }}
                                />
                                <span style={{
                                    flex: 1, color: task.completed ? '#9ca3af' : 'white',
                                    textDecoration: task.completed ? 'line-through' : 'none'
                                }}>{task.title}</span>
                                <button onClick={() => deleteTask(task.id)} style={{
                                    background: '#e70808', color: 'white', border: 'none',
                                    borderRadius: '0.25rem', padding: '0.25rem 0.75rem', cursor: 'pointer'
                                }}>✕</button>
                            </li>
                        ))}
                    </ul>
                )}
                {tasks.length === 0 && !loading && (
                    <p style={{ color: '#9ca3af', textAlign: 'center' }}>Нет задач. Добавьте первую!</p>
                )}
            </div>
        </div>
    );
}

export default App;
