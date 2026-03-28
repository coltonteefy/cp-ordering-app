import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import './PromoSchedule.css';

const PromoSchedule = ({ onSuccess, onError }) => {
  const [promos, setPromos] = useState([]);
  const [promoIdeasFromDb, setPromoIdeasFromDb] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingIdea, setEditingIdea] = useState(null);
  const [editedIdeas, setEditedIdeas] = useState({});
  const [newPromo, setNewPromo] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    discount: '',
    active: true
  });

  // Group promos by month - only use Firebase data
  const currentPromoIdeas = promoIdeasFromDb;
  const groupedPromos = currentPromoIdeas.reduce((acc, promo) => {
    if (!acc[promo.month]) {
      acc[promo.month] = [];
    }
    acc[promo.month].push(promo);
    return acc;
  }, {});

  const months = Object.keys(groupedPromos);

  // Check if a promo is expired
  const isExpired = (duration) => {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    
    // Parse the duration string like "January 1-15" or "January 16-31"
    const match = duration.match(/(\w+)\s+(\d+)-(\d+)/);
    if (!match) return false;
    
    const [, month, , endDay] = match;
    const monthIndex = new Date(`${month} 1, ${currentYear}`).getMonth();
    const endDate = new Date(currentYear, monthIndex, parseInt(endDay), 23, 59, 59);
    
    return currentDate > endDate;
  };

  const getIdeaKey = (month, index) => `${month}-${index}`;

  const getIdeaData = (month, index) => {
    const idea = groupedPromos[month][index];
    const key = getIdeaKey(month, index);
    return editedIdeas[key] || idea;
  };

  const startEditingIdea = (month, index) => {
    const key = getIdeaKey(month, index);
    setEditingIdea(key);
  };

  const cancelEditingIdea = () => {
    setEditingIdea(null);
  };

  const saveIdeaEdit = async (month, index) => {
    const key = getIdeaKey(month, index);
    const editedIdea = editedIdeas[key];
    
    if (!editedIdea) {
      setEditingIdea(null);
      return;
    }

    try {
      // Save to Firebase with the structured document ID
      await setDoc(doc(db, 'c&pPromoSchedule', editedIdea.id), {
        title: editedIdea.title,
        description: editedIdea.description,
        discount: editedIdea.discount,
        duration: editedIdea.duration,
        month: editedIdea.month,
        order: editedIdea.order,
        updatedAt: new Date().toISOString()
      });
      setEditingIdea(null);
      setEditedIdeas(prev => {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });
      onSuccess('Promo idea updated');
    } catch (error) {
      console.error('Error updating promo idea:', error);
      onError('Error updating promo idea: ' + error.message);
    }
  };

  const updateIdeaField = (month, index, field, value) => {
    const key = getIdeaKey(month, index);
    const currentIdea = editedIdeas[key] || groupedPromos[month][index];
    setEditedIdeas({
      ...editedIdeas,
      [key]: {
        ...currentIdea,
        [field]: value
      }
    });
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'promoSchedule'),
      (snapshot) => {
        const promosData = [];
        snapshot.forEach((doc) => {
          promosData.push({
            id: doc.id,
            ...doc.data()
          });
        });
        // Sort by start date
        promosData.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        setPromos(promosData);
      },
      (error) => {
        console.error('Error listening to promos:', error);
        onError('Error loading promos: ' + error.message);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Load promo ideas from Firebase
    const unsubscribe = onSnapshot(
      collection(db, 'c&pPromoSchedule'),
      (snapshot) => {
        const ideasData = [];
        snapshot.forEach((doc) => {
          ideasData.push({
            id: doc.id,
            ...doc.data()
          });
        });
        
        // Sort by month order
        const monthOrder = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        ideasData.sort((a, b) => {
          const monthCompare = monthOrder.indexOf(a.month) - monthOrder.indexOf(b.month);
          if (monthCompare !== 0) return monthCompare;
          return (a.order || 0) - (b.order || 0);
        });
        
        setPromoIdeasFromDb(ideasData);
      },
      (error) => {
        console.error('Error listening to promo ideas:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleAddPromo = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'promoSchedule'), {
        ...newPromo,
        createdAt: new Date().toISOString()
      });
      setNewPromo({
        title: '',
        description: '',
        startDate: '',
        endDate: '',
        discount: '',
        active: true
      });
      setShowAddForm(false);
      onSuccess('Promo added successfully');
    } catch (error) {
      onError('Error adding promo: ' + error.message);
    }
  };

  const handleToggleActive = async (promoId, currentStatus) => {
    try {
      await updateDoc(doc(db, 'promoSchedule', promoId), {
        active: !currentStatus
      });
      onSuccess('Promo status updated');
    } catch (error) {
      onError('Error updating promo: ' + error.message);
    }
  };

  const handleDeletePromo = async (promoId) => {
    if (window.confirm('Are you sure you want to delete this promo?')) {
      try {
        await deleteDoc(doc(db, 'promoSchedule', promoId));
        onSuccess('Promo deleted successfully');
      } catch (error) {
        onError('Error deleting promo: ' + error.message);
      }
    }
  };

  return (
    <div className="promo-schedule">
      <div className="promo-hero">
        <div className="promo-hero-text">
          <span className="promo-hero-eyebrow">Promo Schedule</span>
          <h1>Plan the year, share the savings</h1>
          <p>Keep every monthly campaign idea visible, editable, and ready to launch.</p>
        </div>
        <div className="promo-hero-metrics">
          <div className="promo-metric-card">
            <div className="promo-metric-label">Ideas</div>
            <div className="promo-metric-value">{promoIdeasFromDb.length}</div>
          </div>
          <div className="promo-metric-card">
            <div className="promo-metric-label">Active Promos</div>
            <div className="promo-metric-value">{promos.filter(p => p.active).length}</div>
          </div>
        </div>
      </div>

      <div className="promo-header">
        <h2 className="text-glow-fuchsia">Promo Schedule - 24 Campaign Ideas</h2>
        <button onClick={() => setShowAddForm(!showAddForm)} className="btn-neon-cyan">
          {showAddForm ? 'Cancel' : 'Add Custom Promo'}
        </button>
      </div>

      {showAddForm && (
        <div className="add-promo-form">
          <h3>Add Custom Promo</h3>
          <form onSubmit={handleAddPromo}>
            <div className="form-row">
              <div className="form-group">
                <label>Title</label>
                <input
                  type="text"
                  value={newPromo.title}
                  onChange={(e) => setNewPromo({ ...newPromo, title: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Discount %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={newPromo.discount}
                  onChange={(e) => setNewPromo({ ...newPromo, discount: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  required
                />
              </div>
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={newPromo.description}
                onChange={(e) => setNewPromo({ ...newPromo, description: e.target.value })}
                rows="3"
                required
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Start Date</label>
                <input
                  type="date"
                  value={newPromo.startDate}
                  onChange={(e) => setNewPromo({ ...newPromo, startDate: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>End Date</label>
                <input
                  type="date"
                  value={newPromo.endDate}
                  onChange={(e) => setNewPromo({ ...newPromo, endDate: e.target.value })}
                  required
                />
              </div>
            </div>
            <button type="submit" className="btn-neon-lime">Add Promo</button>
          </form>
        </div>
      )}

      {/* Promo Ideas Section */}
      <div className="promo-ideas-section">
        <h3 className="ideas-title">📅 Year-Round Campaign Ideas (2 per month)</h3>
        <div className="months-container">
          {months.map((month) => (
            <div key={month} className="month-section">
              <h4 className="month-title">{month}</h4>
              <div className="month-promos">
                {groupedPromos[month].map((idea, index) => {
                  const ideaData = getIdeaData(month, index);
                  const expired = isExpired(ideaData.duration);
                  const key = getIdeaKey(month, index);
                  const isEditing = editingIdea === key;

                  return (
                    <div key={index} className={`idea-card ${expired ? 'expired' : ''} ${isEditing ? 'editing' : ''}`}>
                      {isEditing ? (
                        <div className="idea-edit-form">
                          <div className="edit-field">
                            <label>Discount %</label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={ideaData.discount}
                              onChange={(e) => updateIdeaField(month, index, 'discount', parseInt(e.target.value))}
                              onFocus={(e) => e.target.select()}
                              className="edit-input-small"
                            />
                          </div>
                          <div className="edit-field">
                            <label>Title</label>
                            <input
                              type="text"
                              value={ideaData.title}
                              onChange={(e) => updateIdeaField(month, index, 'title', e.target.value)}
                              className="edit-input"
                            />
                          </div>
                          <div className="edit-field">
                            <label>Description</label>
                            <textarea
                              value={ideaData.description}
                              onChange={(e) => updateIdeaField(month, index, 'description', e.target.value)}
                              rows="2"
                              className="edit-textarea"
                            />
                          </div>
                          <div className="edit-field">
                            <label>Duration</label>
                            <input
                              type="text"
                              value={ideaData.duration}
                              onChange={(e) => updateIdeaField(month, index, 'duration', e.target.value)}
                              className="edit-input"
                              placeholder="e.g., January 1-15"
                            />
                          </div>
                          <div className="edit-actions">
                            <button onClick={() => saveIdeaEdit(month, index)} className="btn-save-edit">Save</button>
                            <button onClick={cancelEditingIdea} className="btn-cancel-edit-idea">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="idea-header">
                            <span className="idea-discount">{ideaData.discount}% OFF</span>
                            {expired && <span className="expired-badge">Expired</span>}
                            <button onClick={() => startEditingIdea(month, index)} className="btn-edit-idea" title="Edit promo">✏️</button>
                          </div>
                          <h5 className="idea-title">{ideaData.title}</h5>
                          <p className="idea-description">{ideaData.description}</p>
                          <div className="idea-duration">{ideaData.duration}</div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Strategy Tips Section */}
      <div className="strategy-section">
        <h3 className="strategy-title">💡 Promo Strategy Tips</h3>
        <div className="strategy-grid">
          <div className="strategy-card">
            <h4>Best Practices</h4>
            <ul>
              <li>Announce 3-5 days in advance via email/social</li>
              <li>Highlight specific products to drive interest</li>
              <li>Create urgency with countdown timers</li>
              <li>Bundle deals encourage larger orders</li>
              <li>Seasonal themes make promos memorable</li>
            </ul>
          </div>
          <div className="strategy-card">
            <h4>Product Rotation</h4>
            <ul>
              <li><strong>Week 1:</strong> General sitewide discount (15-20%)</li>
              <li><strong>Week 3:</strong> Category spotlight (20-25%)</li>
            </ul>
          </div>
          <div className="strategy-card">
            <h4>Special Event Promos</h4>
            <ul>
              <li>New product launches: 20% off first 2 weeks</li>
              <li>Customer appreciation: Random surprises</li>
              <li>Bulk orders: Tiered discounts (10%/15%/20%)</li>
              <li>Referral rewards: 15% off for both parties</li>
            </ul>
          </div>
          <div className="strategy-card">
            <h4>Email Subject Lines</h4>
            <ul>
              <li>🔬 Research Alert: [Product] 20% Off</li>
              <li>⚡ Flash Sale: 24 Hours to Save Big</li>
              <li>🎯 Spotlight Sale: Premium Peptides</li>
              <li>💰 Double Discount Days: Stack Savings</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Custom Promos from Firebase */}
      {promos.length > 0 && (
        <div className="custom-promos-section">
          <h3 className="custom-title">🎯 Your Custom Promos</h3>
          <div className="promos-list">
            {promos.map((promo) => (
              <div key={promo.id} className={`promo-card ${promo.active ? 'active' : 'inactive'}`}>
                <div className="promo-header-row">
                  <div>
                    <h3>{promo.title}</h3>
                    <span className="promo-discount">{promo.discount}% OFF</span>
                  </div>
                  <div className="promo-actions">
                    <button
                      onClick={() => handleToggleActive(promo.id, promo.active)}
                      className={`btn-toggle ${promo.active ? 'active' : ''}`}
                    >
                      {promo.active ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      onClick={() => handleDeletePromo(promo.id)}
                      className="btn-delete"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="promo-description">{promo.description}</p>
                <div className="promo-dates">
                  <span>📅 {new Date(promo.startDate).toLocaleDateString()} - {new Date(promo.endDate).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PromoSchedule;
