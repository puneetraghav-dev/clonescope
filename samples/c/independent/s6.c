#include <stdio.h>
#include <limits.h>

struct Stats {
    long sum;
    int max, min, second, evens;
};

struct Stats analyse(const int *a, int n) {
    struct Stats st = {0, INT_MIN, INT_MAX, INT_MIN, 0};
    for (int i = 0; i < n; ++i) {
        int x = a[i];
        st.sum += x;
        if (x > st.max) {
            st.second = st.max;
            st.max = x;
        } else if (x < st.max && x > st.second) {
            st.second = x;
        }
        if (x < st.min) st.min = x;
        if (!(x & 1)) st.evens++;
    }
    return st;
}

int main(void) {
    int n, a[128];
    if (scanf("%d", &n) != 1) return 1;
    for (int i = 0; i < n; ++i) scanf("%d", a + i);
    struct Stats st = analyse(a, n);
    printf("Sum: %ld\n", st.sum);
    printf("Average: %.2f\n", (double)st.sum / n);
    printf("Max: %d\n", st.max);
    printf("Min: %d\n", st.min);
    if (st.second == INT_MIN) printf("Second largest: none\n");
    else printf("Second largest: %d\n", st.second);
    printf("Even: %d Odd: %d\n", st.evens, n - st.evens);
    fputs("Reversed:", stdout);
    for (int i = n - 1; i >= 0; --i) printf(" %d", a[i]);
    printf("\n");
    int same = 1;
    for (int i = 0, j = n - 1; i < j; ++i, --j) same = same && a[i] == a[j];
    printf("Palindrome: %s\n", same ? "Yes" : "No");
    return 0;
}
