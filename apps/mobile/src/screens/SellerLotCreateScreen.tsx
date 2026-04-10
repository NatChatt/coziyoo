import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../components/ScreenHeader';
import { apiRequest } from '../utils/api';
import { t, formatCopy } from '../copy/brandCopy';
import { theme } from '../theme/colors';

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  userType: string;
  email: string;
};

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
  preselectedFoodId?: string;
};

type Step = 1 | 2 | 3 | 4;

type FoodSummary = {
  id: string;
  name: string;
  price: number;
  is_active: boolean;
  recipe?: string | null;
  ingredients_json?: string[] | null;
  allergens_json?: string[] | null;
};

type FoodDetail = FoodSummary & {
  recipe: string | null;
  ingredients_json: string[] | null;
  allergens_json: string[] | null;
};

type FormState = {
  producedAt: string;
  saleStartsAt: string;
  saleEndsAt: string;
  useBy: string;
  bestBefore: string;
  quantityProduced: string;
  quantityAvailable: string;
  notes: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function plusDayIso(iso: string): string {
  const d = new Date(iso);
  d.setHours(d.getHours() + 24);
  return d.toISOString();
}

function foodMissingSpecs(food: FoodSummary): boolean {
  const hasRecipe = !!food.recipe;
  const hasIngredients = Array.isArray(food.ingredients_json) && food.ingredients_json.length > 0;
  const hasAllergens = Array.isArray(food.allergens_json) && food.allergens_json.length > 0;
  return !hasRecipe || !hasIngredients || !hasAllergens;
}

export default function SellerLotCreateScreen({
  auth,
  onBack,
  onAuthRefresh,
  preselectedFoodId,
}: Props) {
  const [step, setStep] = useState<Step>(preselectedFoodId ? 2 : 1);

  // Step 1
  const [foods, setFoods] = useState<FoodSummary[]>([]);
  const [foodsLoading, setFoodsLoading] = useState(false);
  const [selectedFoodId, setSelectedFoodId] = useState<string | null>(
    preselectedFoodId ?? null,
  );

  // Step 2
  const [foodDetail, setFoodDetail] = useState<FoodDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editRecipe, setEditRecipe] = useState(false);
  const [editIngredients, setEditIngredients] = useState(false);
  const [editAllergens, setEditAllergens] = useState(false);
  const [editedRecipe, setEditedRecipe] = useState('');
  const [editedIngredients, setEditedIngredients] = useState('');
  const [editedAllergens, setEditedAllergens] = useState('');

  // Step 3
  const nowStr = nowIso();
  const [form, setForm] = useState<FormState>({
    producedAt: nowStr,
    saleStartsAt: nowStr,
    saleEndsAt: plusDayIso(nowStr),
    useBy: '',
    bestBefore: '',
    quantityProduced: '10',
    quantityAvailable: '10',
    notes: '',
  });
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // Date picker modal
  const [activeDateField, setActiveDateField] = useState<'useBy' | 'bestBefore' | null>(null);
  const [pendingDateCal, setPendingDateCal] = useState<Date>(new Date());

  // Step 4
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const currentAuth = auth;

  const specsEdited = editRecipe || editIngredients || editAllergens;

  // Load foods list
  const loadFoods = useCallback(async () => {
    setFoodsLoading(true);
    const result = await apiRequest<{ results: FoodSummary[] }>(
      '/v1/seller/foods',
      currentAuth,
      { method: 'GET', actorRole: 'seller' },
    );
    setFoodsLoading(false);
    if (result.ok) {
      setFoods(result.data.results ?? (result.data as unknown as FoodSummary[]));
    }
  }, [currentAuth]);

  useEffect(() => {
    if (step === 1) {
      loadFoods();
    }
  }, [step, loadFoods]);

  // Load food detail — uses the list endpoint with foodId query param because
  // the /foods/:id path only supports PATCH (no GET handler on backend).
  const loadFoodDetail = useCallback(
    async (foodId: string) => {
      setDetailLoading(true);
      setFoodDetail(null);
      const result = await apiRequest<{ data: FoodDetail[] } | FoodDetail[]>(
        `/v1/seller/foods?foodId=${foodId}`,
        currentAuth,
        { method: 'GET', actorRole: 'seller' },
      );
      setDetailLoading(false);
      if (!result.ok) return;
      // The list endpoint returns { data: [...] } and apiRequest unwraps to data field.
      // So result.data is the array directly.
      const rows = Array.isArray(result.data)
        ? (result.data as FoodDetail[])
        : [];
      const d = rows.find((f: any) => f.id === foodId) ?? rows[0] ?? null;
      if (!d) return;
      setFoodDetail(d);
      setEditedRecipe(d.recipe ?? '');
      setEditedIngredients(
        Array.isArray(d.ingredients_json) ? d.ingredients_json.join(', ') : '',
      );
      setEditedAllergens(
        Array.isArray(d.allergens_json) ? d.allergens_json.join(', ') : '',
      );
    },
    [currentAuth],
  );

  useEffect(() => {
    if (step === 2 && selectedFoodId) {
      loadFoodDetail(selectedFoodId);
    }
  }, [step, selectedFoodId, loadFoodDetail]);

  function goToStep(next: Step) {
    setStep(next);
  }

  function handleSelectFood(id: string) {
    setSelectedFoodId(id);
  }

  function handleChangeFood() {
    setSelectedFoodId(null);
    setFoodDetail(null);
    setEditRecipe(false);
    setEditIngredients(false);
    setEditAllergens(false);
    goToStep(1);
  }

  function handleStep1Next() {
    if (!selectedFoodId) return;
    goToStep(2);
  }

  function handleStep2Next() {
    goToStep(3);
  }

  function validateStep3(): boolean {
    const errors: Partial<Record<keyof FormState, string>> = {};
    const { producedAt, saleStartsAt, saleEndsAt, quantityProduced, quantityAvailable } = form;

    if (!producedAt.trim()) errors.producedAt = t('error.seller.lotCreate.validation');
    if (!saleStartsAt.trim()) errors.saleStartsAt = t('error.seller.lotCreate.validation');
    if (!saleEndsAt.trim()) errors.saleEndsAt = t('error.seller.lotCreate.validation');
    if (!quantityProduced.trim()) errors.quantityProduced = t('error.seller.lotCreate.validation');
    if (!quantityAvailable.trim()) errors.quantityAvailable = t('error.seller.lotCreate.validation');

    const produced = Number(quantityProduced);
    const available = Number(quantityAvailable);

    if (produced <= 0 || isNaN(produced)) {
      errors.quantityProduced = t('error.seller.lotCreate.validation');
    }
    if (available <= 0 || isNaN(available)) {
      errors.quantityAvailable = t('error.seller.lotCreate.validation');
    }
    if (!errors.quantityAvailable && !errors.quantityProduced && available > produced) {
      errors.quantityAvailable = t('error.seller.lotCreate.validation');
    }

    try {
      if (!errors.producedAt && !errors.saleStartsAt) {
        if (new Date(producedAt) > new Date(saleStartsAt)) {
          errors.saleStartsAt = t('error.seller.lotCreate.validation');
        }
      }
      if (!errors.saleStartsAt && !errors.saleEndsAt) {
        if (new Date(saleStartsAt) > new Date(saleEndsAt)) {
          errors.saleEndsAt = t('error.seller.lotCreate.validation');
        }
      }
    } catch (_) {
      // ignore date parse errors — already caught above
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleStep3Next() {
    if (validateStep3()) {
      goToStep(4);
    }
  }

  async function handleCreate() {
    setSubmitError(null);
    setSubmitting(true);

    const body: Record<string, unknown> = {
      foodId: selectedFoodId,
      producedAt: form.producedAt,
      saleStartsAt: form.saleStartsAt,
      saleEndsAt: form.saleEndsAt,
      quantityProduced: Number(form.quantityProduced),
      quantityAvailable: Number(form.quantityAvailable),
    };

    if (form.useBy) body.useBy = form.useBy;
    if (form.bestBefore) body.bestBefore = form.bestBefore;
    if (form.notes) body.notes = form.notes;

    if (specsEdited) {
      if (editRecipe) body.recipeSnapshot = editedRecipe;
      if (editIngredients) {
        body.ingredientsSnapshot = editedIngredients
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (editAllergens) {
        body.allergensSnapshot = editedAllergens
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    const result = await apiRequest<unknown>('/v1/seller/lots', currentAuth, {
      method: 'POST',
      body,
      actorRole: 'seller',
    });

    setSubmitting(false);

    if (result.ok) {
      Alert.alert(t('headline.common.success'), t('status.seller.lotCreate.success'), [
        { text: 'Tamam', onPress: onBack },
      ]);
    } else {
      setSubmitError(t('error.seller.lotCreate.failed'));
    }
  }

  function updateForm(key: keyof FormState, value: string) {
    setForm((prev) => {
      const updated = { ...prev, [key]: value };
      if (key === 'quantityProduced') {
        updated.quantityAvailable = value;
      }
      return updated;
    });
    setFormErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  const selectedFood = foods.find((f) => f.id === selectedFoodId);
  const stepTitles: Record<Step, string> = {
    1: t('headline.seller.lotCreate.step1'),
    2: t('headline.seller.lotCreate.step2'),
    3: t('headline.seller.lotCreate.step3'),
    4: t('headline.seller.lotCreate.step4'),
  };

  function renderStepIndicator() {
    return (
      <View style={styles.stepIndicator}>
        <Text style={styles.stepIndicatorText}>
          {`${formatCopy('label.seller.lotCreate.stepIndicator', { step })} — ${stepTitles[step]}`}
        </Text>
        <View style={styles.stepDots}>
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <View
              key={s}
              style={[styles.stepDot, step === s && styles.stepDotActive, step > s && styles.stepDotDone]}
            />
          ))}
        </View>
      </View>
    );
  }

  function renderStep1() {
    return (
      <View style={styles.stepContent}>
        <Text style={styles.helperText}>{t('helper.seller.lotCreate.selectFood')}</Text>

        {foodsLoading ? (
          <ActivityIndicator color={theme.primary} style={styles.loader} />
        ) : (
          <View style={styles.foodList}>
            {foods.map((food) => {
              const isSelected = food.id === selectedFoodId;
              const missing = foodMissingSpecs(food);
              return (
                <TouchableOpacity
                  key={food.id}
                  style={[styles.foodCard, isSelected && styles.foodCardSelected]}
                  onPress={() => handleSelectFood(food.id)}
                  activeOpacity={0.75}
                >
                  <View style={styles.foodCardRow}>
                    <View style={styles.foodCardInfo}>
                      <Text style={styles.foodCardName}>{food.name}</Text>
                      <Text style={styles.foodCardPrice}>{`₺${food.price}`}</Text>
                    </View>
                    <View
                      style={[
                        styles.badge,
                        food.is_active ? styles.badgeActive : styles.badgePassive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          food.is_active ? styles.badgeActiveText : styles.badgePassiveText,
                        ]}
                      >
                        {food.is_active ? t('status.seller.foodsManager.active') : t('status.seller.foodsManager.passive')}
                      </Text>
                    </View>
                  </View>
                  {missing && (
                    <Text style={styles.missingSpecsText}>
                      {`⚠️ ${t('helper.seller.lotCreate.foodMissingSpecs')}`}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryButton, !selectedFoodId && styles.primaryButtonDisabled]}
          onPress={handleStep1Next}
          disabled={!selectedFoodId}
        >
          <Text style={styles.primaryButtonText}>{t('cta.seller.lotCreate.next')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderStep2() {
    if (detailLoading) {
      return (
        <View style={styles.stepContent}>
          <ActivityIndicator color={theme.primary} style={styles.loader} />
        </View>
      );
    }

    if (!foodDetail) {
      return (
        <View style={styles.stepContent}>
          <Text style={styles.helperText}>{t('error.seller.lotCreate.detailLoad')}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleChangeFood}>
            <Text style={styles.secondaryButtonText}>{t('cta.common.goBack')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.stepContent}>
        {selectedFood && (
          <View style={styles.selectedFoodBanner}>
            <Text style={styles.selectedFoodName}>{selectedFood.name}</Text>
            <TouchableOpacity onPress={handleChangeFood} style={styles.changeFoodBtn}>
              <Text style={styles.changeFoodBtnText}>{t('cta.seller.lotCreate.changeFood')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.helperText}>{t('helper.seller.lotCreate.reviewSpecs')}</Text>

        {/* Recipe */}
        <View style={styles.specsSection}>
          <View style={styles.specsSectionHeader}>
            <Text style={styles.specsSectionTitle}>{t('label.seller.lotCreate.recipe')}</Text>
            <TouchableOpacity
              style={[styles.editToggleBtn, editRecipe && styles.editToggleBtnActive]}
              onPress={() => setEditRecipe((v) => !v)}
            >
              <Text
                style={[styles.editToggleBtnText, editRecipe && styles.editToggleBtnTextActive]}
              >
                {t('cta.seller.lotCreate.editSpecs')}
              </Text>
            </TouchableOpacity>
          </View>
          {editRecipe ? (
            <TextInput
              style={styles.specTextInput}
              value={editedRecipe}
              onChangeText={setEditedRecipe}
              multiline
              placeholder={t('placeholder.seller.lotCreate.recipe')}
              placeholderTextColor={theme.textSecondary}
            />
          ) : (
            <Text style={styles.specsValue}>
              {foodDetail.recipe || '—'}
            </Text>
          )}
        </View>

        {/* Ingredients */}
        <View style={styles.specsSection}>
          <View style={styles.specsSectionHeader}>
            <Text style={styles.specsSectionTitle}>{t('label.seller.lotCreate.ingredients')}</Text>
            <TouchableOpacity
              style={[styles.editToggleBtn, editIngredients && styles.editToggleBtnActive]}
              onPress={() => setEditIngredients((v) => !v)}
            >
              <Text
                style={[
                  styles.editToggleBtnText,
                  editIngredients && styles.editToggleBtnTextActive,
                ]}
              >
                {t('cta.seller.lotCreate.editSpecs')}
              </Text>
            </TouchableOpacity>
          </View>
          {editIngredients ? (
            <TextInput
              style={styles.specTextInput}
              value={editedIngredients}
              onChangeText={setEditedIngredients}
              multiline
              placeholder={t('placeholder.seller.lotCreate.commaDelimited')}
              placeholderTextColor={theme.textSecondary}
            />
          ) : (
            <Text style={styles.specsValue}>
              {(foodDetail.ingredients_json ?? []).join(', ') || '—'}
            </Text>
          )}
        </View>

        {/* Allergens */}
        <View style={styles.specsSection}>
          <View style={styles.specsSectionHeader}>
            <Text style={styles.specsSectionTitle}>{t('label.seller.lotCreate.allergens')}</Text>
            <TouchableOpacity
              style={[styles.editToggleBtn, editAllergens && styles.editToggleBtnActive]}
              onPress={() => setEditAllergens((v) => !v)}
            >
              <Text
                style={[
                  styles.editToggleBtnText,
                  editAllergens && styles.editToggleBtnTextActive,
                ]}
              >
                {t('cta.seller.lotCreate.editSpecs')}
              </Text>
            </TouchableOpacity>
          </View>
          {editAllergens ? (
            <TextInput
              style={styles.specTextInput}
              value={editedAllergens}
              onChangeText={setEditedAllergens}
              multiline
              placeholder={t('placeholder.seller.lotCreate.commaDelimited')}
              placeholderTextColor={theme.textSecondary}
            />
          ) : (
            <Text style={styles.specsValue}>
              {(foodDetail.allergens_json ?? []).join(', ') || '—'}
            </Text>
          )}
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleStep2Next}>
          <Text style={styles.primaryButtonText}>{t('cta.seller.lotCreate.next')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderStep3() {
    return (
      <View style={styles.stepContent}>
        <FormField
          label={t('helper.seller.lotCreate.productionTime')}
          value={form.producedAt}
          onChangeText={(v) => updateForm('producedAt', v)}
          error={formErrors.producedAt}
          placeholder="ISO 8601"
        />
        <FormField
          label={t('helper.seller.lotCreate.saleStart')}
          value={form.saleStartsAt}
          onChangeText={(v) => updateForm('saleStartsAt', v)}
          error={formErrors.saleStartsAt}
          placeholder="ISO 8601"
        />
        <FormField
          label={t('helper.seller.lotCreate.saleEnd')}
          value={form.saleEndsAt}
          onChangeText={(v) => updateForm('saleEndsAt', v)}
          error={formErrors.saleEndsAt}
          placeholder="ISO 8601"
        />
        <DatePickerRow
          label={t('helper.seller.lotCreate.useBy')}
          value={form.useBy}
          onPress={() => {
            setPendingDateCal(form.useBy ? new Date(form.useBy) : new Date());
            setActiveDateField('useBy');
          }}
        />
        <DatePickerRow
          label={t('helper.seller.lotCreate.bestBefore')}
          value={form.bestBefore}
          onPress={() => {
            setPendingDateCal(form.bestBefore ? new Date(form.bestBefore) : new Date());
            setActiveDateField('bestBefore');
          }}
        />
        <FormField
          label={t('helper.seller.lotCreate.quantity')}
          value={form.quantityProduced}
          onChangeText={(v) => updateForm('quantityProduced', v)}
          error={formErrors.quantityProduced}
          keyboardType="number-pad"
          placeholder="10"
        />
        <FormField
          label={t('helper.seller.lotCreate.quantityAvailable')}
          value={form.quantityAvailable}
          onChangeText={(v) => updateForm('quantityAvailable', v)}
          error={formErrors.quantityAvailable}
          keyboardType="number-pad"
          placeholder={form.quantityProduced}
        />
        <FormField
          label={t('helper.seller.lotCreate.notes')}
          value={form.notes}
          onChangeText={(v) => updateForm('notes', v)}
          placeholder={t('placeholder.seller.lotCreate.isoOptional')}
          multiline
        />

        <TouchableOpacity style={styles.primaryButton} onPress={handleStep3Next}>
          <Text style={styles.primaryButtonText}>{t('cta.seller.lotCreate.next')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderStep4() {
    const food = foodDetail ?? selectedFood;
    return (
      <View style={styles.stepContent}>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('label.seller.lotCreate.food')}</Text>
            <Text style={styles.summaryValue}>{food?.name ?? '—'}</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('label.seller.lotCreate.specs')}</Text>
            <View
              style={[
                styles.specsBadge,
                specsEdited ? styles.specsBadgeModified : styles.specsBadgeUnchanged,
              ]}
            >
              <Text style={styles.specsBadgeText}>
                {specsEdited
                  ? t('helper.seller.lotCreate.specsModified')
                  : t('helper.seller.lotCreate.specsUnchanged')}
              </Text>
            </View>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('helper.seller.lotCreate.productionTime')}</Text>
            <Text style={styles.summaryValue}>{form.producedAt}</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('label.seller.lotCreate.saleWindow')}</Text>
            <Text style={styles.summaryValue}>
              {`${form.saleStartsAt}\n→ ${form.saleEndsAt}`}
            </Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('helper.seller.lotCreate.quantity')}</Text>
            <Text style={styles.summaryValue}>{form.quantityProduced}</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('helper.seller.lotCreate.quantityAvailable')}</Text>
            <Text style={styles.summaryValue}>{form.quantityAvailable}</Text>
          </View>

          {!!form.useBy && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('helper.seller.lotCreate.useBy')}</Text>
              <Text style={styles.summaryValue}>{formatDateDisplay(form.useBy)}</Text>
            </View>
          )}

          {!!form.bestBefore && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('helper.seller.lotCreate.bestBefore')}</Text>
              <Text style={styles.summaryValue}>{formatDateDisplay(form.bestBefore)}</Text>
            </View>
          )}

          {!!form.notes && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('helper.seller.lotCreate.notes')}</Text>
              <Text style={styles.summaryValue}>{form.notes}</Text>
            </View>
          )}
        </View>

        {!!submitError && (
          <Text style={styles.errorText}>{submitError}</Text>
        )}

        <TouchableOpacity
          style={[styles.primaryButton, submitting && styles.primaryButtonDisabled]}
          onPress={handleCreate}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>{t('cta.seller.lotCreate.create')}</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  function renderBackButton() {
    if (step === 1) return null;
    const prevStep = (step - 1) as Step;
    return (
      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => goToStep(prevStep)}
      >
        <Text style={styles.secondaryButtonText}>{t('cta.seller.lotCreate.back')}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScreenHeader title={t('headline.seller.lotCreate.title')} onBack={onBack} />
      {renderStepIndicator()}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {renderBackButton()}
      </ScrollView>

      {/* Date picker modal — useBy / bestBefore */}
      <Modal
        visible={activeDateField !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveDateField(null)}
      >
        <TouchableOpacity
          style={styles.calModalOverlay}
          activeOpacity={1}
          onPress={() => setActiveDateField(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.calModalCard}>
            <Text style={styles.calModalTitle}>
              {activeDateField === 'useBy'
                ? t('helper.seller.lotCreate.useBy')
                : t('helper.seller.lotCreate.bestBefore')}
            </Text>
            <CalendarPicker
              value={pendingDateCal}
              onSelect={(date) => {
                if (activeDateField) {
                  updateForm(activeDateField, dateToEndOfDayIso(date));
                }
                setActiveDateField(null);
              }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Inline Calendar Picker (shared logic with SellerFoodsScreen) ──────────

const CAL_MONTH_NAMES = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const CAL_DAY_LABELS = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];

function CalendarPicker({ value, onSelect }: { value: Date; onSelect: (date: Date) => void }) {
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;

  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  return (
    <View style={calStyles.container}>
      <View style={calStyles.header}>
        <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <Ionicons name="chevron-back" size={20} color="#2E241C" />
        </TouchableOpacity>
        <Text style={calStyles.monthTitle}>{CAL_MONTH_NAMES[viewMonth]} {viewYear}</Text>
        <TouchableOpacity onPress={nextMonth} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <Ionicons name="chevron-forward" size={20} color="#2E241C" />
        </TouchableOpacity>
      </View>
      <View style={calStyles.dayLabelsRow}>
        {CAL_DAY_LABELS.map(label => (
          <Text key={label} style={calStyles.dayLabel}>{label}</Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={calStyles.row}>
          {row.map((day, di) => {
            const selected = day !== null &&
              day === value.getDate() &&
              viewMonth === value.getMonth() &&
              viewYear === value.getFullYear();
            return (
              <TouchableOpacity
                key={di}
                style={[calStyles.dayCell, selected && calStyles.dayCellSelected]}
                onPress={() => { if (day !== null) onSelect(new Date(viewYear, viewMonth, day)); }}
                disabled={day === null}
                activeOpacity={0.7}
              >
                <Text style={[calStyles.dayText, selected && calStyles.dayTextSelected]}>
                  {day !== null ? String(day) : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const calStyles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  monthTitle: { fontSize: 16, fontWeight: '800', color: '#2E241C' },
  dayLabelsRow: { flexDirection: 'row', marginBottom: 4 },
  dayLabel: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', color: '#8A7A6A' },
  row: { flexDirection: 'row', marginBottom: 2 },
  dayCell: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  dayCellSelected: { backgroundColor: '#3F855C' },
  dayText: { fontSize: 15, color: '#2E241C', fontWeight: '500' },
  dayTextSelected: { color: '#fff', fontWeight: '800' },
});

function formatDateDisplay(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getDate()} ${CAL_MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function dateToEndOfDayIso(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).toISOString();
}

// ────────────────────────────────────────────────────────────────────────────

type DatePickerRowProps = {
  label: string;
  value: string; // ISO string or empty
  onPress: () => void;
};

function DatePickerRow({ label, value, onPress }: DatePickerRowProps) {
  const displayText = value ? formatDateDisplay(value) : '—';
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TouchableOpacity style={styles.datePickerRow} onPress={onPress} activeOpacity={0.7}>
        <Text style={[styles.datePickerText, !value && styles.datePickerPlaceholder]}>
          {displayText}
        </Text>
        <Ionicons name="calendar-outline" size={20} color={theme.primary} />
      </TouchableOpacity>
    </View>
  );
}

type FormFieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'email-address';
  multiline?: boolean;
};

function FormField({
  label,
  value,
  onChangeText,
  error,
  placeholder,
  keyboardType = 'default',
  multiline = false,
}: FormFieldProps) {
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput
        style={[styles.formInput, multiline && styles.formInputMultiline, !!error && styles.formInputError]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {!!error && <Text style={styles.fieldErrorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F7F4EF',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  stepIndicator: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F7F4EF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5DDCF',
  },
  stepIndicatorText: {
    fontSize: 13,
    color: theme.textSecondary,
    fontWeight: '600',
    marginBottom: 6,
  },
  stepDots: {
    flexDirection: 'row',
    gap: 6,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5DDCF',
  },
  stepDotActive: {
    backgroundColor: theme.primary,
    width: 20,
  },
  stepDotDone: {
    backgroundColor: theme.primary,
    opacity: 0.4,
  },
  stepContent: {
    paddingTop: 20,
    gap: 12,
  },
  loader: {
    marginTop: 40,
  },
  helperText: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: 4,
  },
  foodList: {
    gap: 10,
  },
  foodCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5DDCF',
    padding: 14,
  },
  foodCardSelected: {
    borderColor: theme.primary,
    borderWidth: 2,
  },
  foodCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  foodCardInfo: {
    flex: 1,
    gap: 2,
  },
  foodCardName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.text,
  },
  foodCardPrice: {
    fontSize: 13,
    color: theme.priceText,
    fontWeight: '500',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeActive: {
    backgroundColor: '#E6F4EB',
  },
  badgePassive: {
    backgroundColor: '#F0EDE8',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  badgeActiveText: {
    color: theme.primary,
  },
  badgePassiveText: {
    color: theme.textSecondary,
  },
  missingSpecsText: {
    fontSize: 12,
    color: '#C4953A',
    marginTop: 6,
  },
  primaryButton: {
    backgroundColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#EFE7DA',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryButtonText: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  selectedFoodBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5DDCF',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  selectedFoodName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.text,
    flex: 1,
  },
  changeFoodBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#EFE7DA',
    borderRadius: 8,
  },
  changeFoodBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.text,
  },
  specsSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5DDCF',
    padding: 14,
    gap: 8,
  },
  specsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  specsSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.text,
  },
  editToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#EFE7DA',
    borderRadius: 8,
  },
  editToggleBtnActive: {
    backgroundColor: theme.primary,
  },
  editToggleBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.text,
  },
  editToggleBtnTextActive: {
    color: '#fff',
  },
  specsValue: {
    fontSize: 13,
    color: theme.textSecondary,
    lineHeight: 18,
  },
  specTextInput: {
    borderWidth: 1,
    borderColor: '#E5DDCF',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: theme.text,
    minHeight: 64,
    textAlignVertical: 'top',
    backgroundColor: '#FAFAF8',
  },
  formField: {
    gap: 5,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.text,
  },
  formInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5DDCF',
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: theme.text,
  },
  formInputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  formInputError: {
    borderColor: theme.error,
  },
  fieldErrorText: {
    fontSize: 12,
    color: theme.error,
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5DDCF',
    padding: 16,
    gap: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryLabel: {
    fontSize: 13,
    color: theme.textSecondary,
    fontWeight: '500',
    flex: 1,
  },
  summaryValue: {
    fontSize: 13,
    color: theme.text,
    fontWeight: '600',
    flex: 2,
    textAlign: 'right',
  },
  specsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  specsBadgeModified: {
    backgroundColor: '#FFF3CD',
  },
  specsBadgeUnchanged: {
    backgroundColor: '#E6F4EB',
  },
  specsBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.text,
  },
  errorText: {
    fontSize: 13,
    color: theme.error,
    textAlign: 'center',
  },
  datePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5DDCF',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  datePickerText: {
    fontSize: 14,
    color: theme.text,
    fontWeight: '500',
  },
  datePickerPlaceholder: {
    color: theme.textSecondary,
  },
  calModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  calModalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    paddingTop: 20,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  calModalTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2E241C',
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 12,
  },
});
